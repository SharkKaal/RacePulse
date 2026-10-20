/* ═══════════════════════════════════════════════════════════════
   RacePulse — F1 Dashboard  ·  app.js
   ═══════════════════════════════════════════════════════════════ */

// ── CONSTANTS ──────────────────────────────────────────────────
const API      = (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin.startsWith('http')) 
                 ? window.location.origin 
                 : 'http://127.0.0.1:8000';
const OPENF1   = 'https://api.openf1.org/v1';
const PLOT_CFG = { responsive: true, displayModeBar: false };

const PLOT_BASE = {
  plot_bgcolor   : 'transparent',
  paper_bgcolor  : 'transparent',
  font           : { color: '#8888a0', family: 'Inter', size: 11 },
  margin         : { t: 10, r: 10, b: 30, l: 45 },
  xaxis          : { showgrid: true, gridcolor: 'rgba(255,255,255,0.04)', zeroline: false,
                     spikemode: 'across', spikethickness: 1, spikecolor: '#fff', spikedash: 'dot' },
  yaxis          : { showgrid: true, gridcolor: 'rgba(255,255,255,0.04)', zeroline: true,
                     zerolinecolor: 'rgba(255,255,255,0.15)' },
  hovermode      : 'x unified',
  showlegend     : true,
  legend         : { orientation: 'h', y: 1.12, x: 0, font: { size: 10 } }
};

function cloneLayout(extra) {
  const base = JSON.parse(JSON.stringify(PLOT_BASE));
  if (!extra) return base;
  for (const key of Object.keys(extra)) {
    if (typeof extra[key] === 'object' && extra[key] !== null && !Array.isArray(extra[key]) && base[key]) {
      base[key] = Object.assign({}, base[key], extra[key]);
    } else {
      base[key] = extra[key];
    }
  }
  return base;
}

let currentRaceLaps      = [];
let loadedViews          = {};
let currentView          = 'race';
let livePollingInterval  = null;

let currentSeasonEvents  = [];
let countdownInterval    = null;

function isEventInFuture(raceRound) {
  if (!currentSeasonEvents || !currentSeasonEvents.length) return false;
  const event = currentSeasonEvents.find(e => String(e.round) === String(raceRound));
  if (!event) return false;
  
  const raceSession = event.sessions.find(s => s.name === 'Race') || event.sessions[event.sessions.length - 1];
  const raceDate = raceSession ? new Date(raceSession.date.endsWith('Z') ? raceSession.date : raceSession.date + 'Z') : new Date(event.date + 'T15:00:00Z');
  return raceDate > new Date();
}

function startCountdown(event) {
  const banner = document.getElementById('upcomingRaceBanner');
  if (!banner) return;
  
  if (countdownInterval) clearInterval(countdownInterval);
  
  const raceSession = event.sessions.find(s => s.name === 'Race') || event.sessions[event.sessions.length - 1];
  const raceDate = raceSession ? new Date(raceSession.date.endsWith('Z') ? raceSession.date : raceSession.date + 'Z') : new Date(event.date + 'T15:00:00Z');
  
  let scheduleHtml = '';
  if (event.sessions && event.sessions.length) {
    scheduleHtml = `
      <div class="upcoming-schedule">
        <h2>Weekend Schedule (UTC & Your Local Time)</h2>
        <div class="schedule-grid">
    `;
    event.sessions.forEach(s => {
      const utcDate = new Date(s.date.endsWith('Z') ? s.date : s.date + 'Z');
      const isPast = utcDate < new Date();
      const activeClass = isPast ? '' : 'active';
      
      const localTimeStr = utcDate.toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      const utcTimeStr = utcDate.toUTCString().replace('GMT', 'UTC');
      
      scheduleHtml += `
        <div class="schedule-card ${activeClass}">
          <div class="session-title">${s.name}</div>
          <div class="session-time">UTC: ${utcTimeStr}</div>
          <div class="session-local">Local: ${localTimeStr}</div>
        </div>
      `;
    });
    scheduleHtml += `</div></div>`;
  }

  function update() {
    const now = new Date();
    const diff = raceDate - now;
    
    if (diff <= 0) {
      clearInterval(countdownInterval);
      banner.innerHTML = `
        <div class="upcoming-header">
          <div class="upcoming-info">
            <h3>${event.name}</h3>
            <h1>${event.official_name || event.name}</h1>
            <p>📍 ${event.location}, ${event.country} • Round ${event.round}</p>
          </div>
          <div class="upcoming-countdown">
            <div class="countdown-label">Status</div>
            <div class="countdown-time" style="color: var(--accent-green)">RACE WEEKEND ACTIVE / LIVE</div>
          </div>
        </div>
        ${scheduleHtml}
      `;
      return;
    }
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const mins = Math.floor((diff / (1000 * 60)) % 60);
    const secs = Math.floor((diff / 1000) % 60);
    
    banner.innerHTML = `
      <div class="upcoming-header">
        <div class="upcoming-info">
          <h3>Upcoming Grand Prix</h3>
          <h1>${event.name}</h1>
          <p>📍 ${event.location}, ${event.country} • Round ${event.round}</p>
          <p style="margin-top: 6px; font-size: 0.85rem; opacity: 0.8;">Official Event: ${event.official_name || '-'}</p>
        </div>
        <div class="upcoming-countdown">
          <div class="countdown-label">RACE STARTS IN</div>
          <div class="countdown-time">
            <div>${days}<span class="countdown-unit">d</span></div>
            <div>${hours}<span class="countdown-unit">h</span></div>
            <div>${mins}<span class="countdown-unit">m</span></div>
            <div>${secs}<span class="countdown-unit">s</span></div>
          </div>
        </div>
      </div>
      ${scheduleHtml}
    `;
  }
  
  update();
  countdownInterval = setInterval(update, 1000);
}

const TYRE_COLORS = {
  SOFT         : '#ff3333',
  MEDIUM       : '#ffdd00',
  HARD         : '#cccccc',
  INTERMEDIATE : '#43b02a',
  WET          : '#0072c6',
  UNKNOWN      : '#888'
};

// ── CLOCK ──────────────────────────────────────────────────────
setInterval(() => {
  const el = document.getElementById('liveClock');
  if (el) el.textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });
}, 1000);

// ── LOADING OVERLAY ────────────────────────────────────────────
function showLoad(msg) {
  const ov = document.getElementById('loading');
  const st = document.getElementById('loadingStatus');
  if (st) st.textContent = msg || 'Loading…';
  if (ov) ov.classList.remove('hidden');
}
function hideLoad() {
  const ov = document.getElementById('loading');
  if (ov) ov.classList.add('hidden');
}

// ── HELPERS ────────────────────────────────────────────────────
function selVal(id) { const e = document.getElementById(id); return e ? e.value : ''; }

function fmtLap(sec) {
  if (sec == null || sec === '' || isNaN(sec)) return '-';
  const s = parseFloat(sec);
  const m = Math.floor(s / 60);
  const rest = (s - m * 60).toFixed(3).padStart(6, '0');
  return m > 0 ? `${m}:${rest}` : rest;
}

function fmtInterval(val, isGap, position) {
  if (val == null || val === '' || isNaN(val) || val === '-') return '-';
  const num = parseFloat(val);
  if (parseInt(position) === 1) {
    return isGap ? 'LEADER' : '-';
  }
  if (num === 0) {
    return isGap ? 'LEADER' : '-';
  }
  return `+${num.toFixed(3)}`;
}

function teamColor(c) { return c && c.startsWith('#') ? c : (c ? '#' + c : '#888'); }

// ── NAVIGATION ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const view = tab.dataset.view;
      if (!view) return;

      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

      tab.classList.add('active');
      const section = document.getElementById('view-' + view);
      if (section) section.classList.add('active');

      currentView = view;
      autoLoadView(view);
    });
  });
});

function autoLoadView(view) {
  if (loadedViews[view]) return;
  switch (view) {
    case 'race':         loadRaceData();         break;
    case 'strategy':     loadStrategyData();     break;
    case 'analysis':     loadAnalysisData();     break;
    case 'championship': loadChampionshipData(); break;
    case 'telemetry':    loadDriverList();        break;
    case 'replay':       loadReplayView();        break;
    case 'live':         initLiveView();          break;
  }
}

async function loadReplayView() {
  const year = selVal('selYear');
  const race = selVal('selRace');
  const session = selVal('selSession') || 'R';

  if (isEventInFuture(race)) {
    const wrapper = document.querySelector('#view-replay .replay-wrapper');
    if (wrapper) wrapper.innerHTML = '<div class="empty-state">Replay is not available for upcoming events.</div>';
    loadedViews.replay = true;
    return;
  }

  ReplayEngine.init('replayCanvas');
  await ReplayEngine.loadReplayData(year, race, session);
  loadedViews.replay = true;
}

// ── YEAR / RACE CHANGE ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const selYear = document.getElementById('selYear');
  const selRace = document.getElementById('selRace');
  const selSession = document.getElementById('selSession');

  if (selYear) {
    selYear.addEventListener('change', async () => {
      loadedViews = {};
      currentRaceLaps = [];
      await loadRaceList();
      autoLoadView(currentView);
    });
  }
  if (selRace) {
    selRace.addEventListener('change', () => {
      loadedViews = {};
      currentRaceLaps = [];
      autoLoadView(currentView);
    });
  }
  if (selSession) {
    selSession.addEventListener('change', () => {
      loadedViews = {};
      currentRaceLaps = [];
      autoLoadView(currentView);
    });
  }
});

// ── RACE LIST ──────────────────────────────────────────────────
async function loadRaceList() {
  try {
    const year = selVal('selYear');
    const res  = await fetch(`${API}/api/race-list?year=${year}`);
    const data = await res.json();
    const events = data.events || [];
    currentSeasonEvents = events;
    const sel  = document.getElementById('selRace');
    if (!sel) return;
    sel.innerHTML = '';
    events.forEach(r => {
      if (r.round === 0) return;
      const o   = document.createElement('option');
      o.value   = r.round;
      o.textContent = r.name || `Round ${r.round}`;
      sel.appendChild(o);
    });
  } catch (e) { console.error('loadRaceList', e); }
}

// ── DRIVER LIST ────────────────────────────────────────────────
async function loadDriverList() {
  try {
    const year = selVal('selYear');
    const race = selVal('selRace');
    const session = selVal('selSession') || 'R';
    const telGrid = document.querySelector('#view-telemetry .tel-grid');
    if (isEventInFuture(race)) {
      ['selDr1', 'selDr2'].forEach(id => {
        const sel = document.getElementById(id);
        if (sel) sel.innerHTML = '<option value="">No drivers available (Upcoming Event)</option>';
      });
      if (telGrid) telGrid.style.display = 'none';
      return;
    } else {
      if (telGrid) telGrid.style.display = 'grid';
    }
    const res  = await fetch(`${API}/api/driver-list?year=${year}&race=${race}&session_type=${session}`);
    const data = await res.json();
    const drivers = data.drivers || [];
    ['selDr1', 'selDr2'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      sel.innerHTML = '';
      drivers.forEach(d => {
        const o   = document.createElement('option');
        o.value   = d.code || '';
        o.textContent = d.name || o.value;
        sel.appendChild(o);
      });
      sel.onchange = populateLapSelectors;
    });

    // Populate lap selectors once drivers are loaded
    await populateLapSelectors();
  } catch (e) { console.error('loadDriverList', e); }
}

async function populateLapSelectors() {
  const dr1 = selVal('selDr1');
  const dr2 = selVal('selDr2');
  if (!dr1 && !dr2) return;

  if (!currentRaceLaps || !currentRaceLaps.length) {
    const year = selVal('selYear');
    const race = selVal('selRace');
    const session = selVal('selSession') || 'R';
    try {
      const res = await fetch(`${API}/api/laps?year=${year}&race=${race}&session_type=${session}`);
      const lData = await res.json();
      currentRaceLaps = lData.laps || [];
    } catch (e) {
      console.error('Failed to load laps for selectors:', e);
    }
  }

  populateLapSelectForDriver('selLap1', dr1);
  populateLapSelectForDriver('selLap2', dr2);
}

function populateLapSelectForDriver(selectId, driverCode) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const currentVal = sel.value;
  sel.innerHTML = '<option value="fastest">Fastest Lap</option>';
  if (!driverCode) return;

  const driverLaps = currentRaceLaps.filter(l => l.driver === driverCode);
  driverLaps.sort((a, b) => a.lap_number - b.lap_number);
  driverLaps.forEach(l => {
    const opt = document.createElement('option');
    opt.value = l.lap_number;
    opt.textContent = `Lap ${l.lap_number} (${l.lap_time_sec ? l.lap_time_sec.toFixed(3) : '-'}s)`;
    sel.appendChild(opt);
  });

  if (driverLaps.some(l => String(l.lap_number) === String(currentVal))) {
    sel.value = currentVal;
  }
}

// ── SECTOR SHAPES HELPER ───────────────────────────────────────
function sectorShapes(s1End, s2End, maxDist) {
  return [
    { type:'rect', xref:'x', yref:'paper', x0:0,       x1:s1End,  y0:0, y1:1, fillcolor:'rgba(255,255,255,0.02)', line:{ width:0 } },
    { type:'rect', xref:'x', yref:'paper', x0:s1End,   x1:s2End,  y0:0, y1:1, fillcolor:'rgba(255,255,255,0.04)', line:{ width:0 } },
    { type:'rect', xref:'x', yref:'paper', x0:s2End,   x1:maxDist,y0:0, y1:1, fillcolor:'rgba(255,255,255,0.02)', line:{ width:0 } },
    { type:'line', xref:'x', yref:'paper', x0:s1End,   x1:s1End,  y0:0, y1:1, line:{ color:'rgba(255,255,255,0.2)', width:1, dash:'dash' } },
    { type:'line', xref:'x', yref:'paper', x0:s2End,   x1:s2End,  y0:0, y1:1, line:{ color:'rgba(255,255,255,0.2)', width:1, dash:'dash' } }
  ];
}

// ═══════════════════════════════════════════════════════════════
//  VIEW 1 — RACE DATA
// ═══════════════════════════════════════════════════════════════
async function loadRaceData() {
  const year = selVal('selYear');
  const race = selVal('selRace');
  const session = selVal('selSession') || 'R';
  const qs   = `year=${year}&race=${race}&session_type=${session}`;

  const banner = document.getElementById('upcomingRaceBanner');
  const raceGrid = document.querySelector('#view-race .race-grid');
  
  if (isEventInFuture(race)) {
    if (banner) {
      banner.classList.remove('hidden');
      const event = currentSeasonEvents.find(e => String(e.round) === String(race));
      if (event) startCountdown(event);
    }
    if (raceGrid) raceGrid.style.display = 'none';
    loadedViews.race = true;
    hideLoad();
    return;
  } else {
    if (banner) {
      banner.classList.add('hidden');
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
    }
    if (raceGrid) raceGrid.style.display = 'grid';
  }

  showLoad('Loading race data…');

  try {
    // ── Race Results ────────────────────────────────────────
    const resResults = await fetch(`${API}/api/results?${qs}`);
    const resData    = await resResults.json();
    const results    = resData.results || [];
    const dnfs       = resData.dnfs || [];
    const teamColors = {};
    results.forEach(r => {
      if (r.driver_code && r.team_color) {
        teamColors[r.driver_code] = r.team_color;
      }
    });
    const tbl1       = document.getElementById('raceResultsTable');
    if (tbl1 && results.length) {
      let html = `<table><thead><tr>
        <th>POS</th><th>DRIVER</th><th>TEAM</th><th>GRID</th><th>STATUS</th><th>PTS</th>
      </tr></thead><tbody>`;
      results.forEach(r => {
        const pos = parseInt(r.position || 0);
        const cls = pos === 1 ? 'pos-gold' : pos === 2 ? 'pos-silver' : pos === 3 ? 'pos-bronze' : '';
        html += `<tr class="${cls}">
          <td>${r.position ?? '-'}</td>
          <td>${r.driver_code || '-'}</td>
          <td>${r.team || '-'}</td>
          <td>${r.grid_position ?? '-'}</td>
          <td>${r.status || '-'}</td>
          <td>${r.points ?? '-'}</td>
        </tr>`;
      });
      html += '</tbody></table>';
      tbl1.innerHTML = html;
    }

    // ── DNF Tracker ──────────────────────────────────────────
    const dnfBox = document.getElementById('dnfTracker');
    if (dnfBox) {
      if (!dnfs || !dnfs.length) {
        dnfBox.innerHTML = `<div class="empty-state">🏁 No retirements recorded. All drivers completed the race.</div>`;
      } else {
        let html = `<table>
          <thead>
            <tr>
              <th>DRIVER</th>
              <th>TEAM</th>
              <th>LAP</th>
              <th>STATUS</th>
            </tr>
          </thead>
          <tbody>`;
        dnfs.forEach(d => {
          let badgeClass = 'ret';
          const stat = (d.status || '').toUpperCase();
          if (stat.includes('DSQ') || stat.includes('DISQUALIFIED')) badgeClass = 'dsq';
          else if (stat.includes('DNS') || stat.includes('DID NOT START') || stat.includes('WITHDREW')) badgeClass = 'dns';
          
          html += `<tr>
            <td><span class="team-dot" style="background:${d.team_color}"></span>${d.driver_code}</td>
            <td>${d.team}</td>
            <td>${d.laps}</td>
            <td><span class="status-badge ${badgeClass}">${d.status}</span></td>
          </tr>`;
        });
        html += `</tbody></table>`;
        dnfBox.innerHTML = html;
      }
    }

    // ── Qualifying Results ──────────────────────────────────
    const resQuali = await fetch(`${API}/api/qualifying?${qs}`);
    const qData    = await resQuali.json();
    const quali    = qData.results || [];
    const tbl2     = document.getElementById('qualiResultsTable');
    if (tbl2 && quali.length) {
      let bestQ3 = Infinity;
      quali.forEach(q => {
        const t = parseFloat(q.q3);
        if (!isNaN(t) && t < bestQ3) bestQ3 = t;
      });
      let html = `<table><thead><tr>
        <th>POS</th><th>DRIVER</th><th>TEAM</th><th>Q1</th><th>Q2</th><th>Q3</th>
      </tr></thead><tbody>`;
      quali.forEach(q => {
        const q3v = parseFloat(q.q3);
        const q3c = (!isNaN(q3v) && q3v === bestQ3) ? 'time-purple' : '';
        html += `<tr>
          <td>${q.position ?? '-'}</td>
          <td>${q.driver_code || '-'}</td>
          <td>${q.team || '-'}</td>
          <td>${fmtLap(q.q1)}</td>
          <td>${fmtLap(q.q2)}</td>
          <td class="${q3c}">${fmtLap(q.q3)}</td>
        </tr>`;
      });
      html += '</tbody></table>';
      tbl2.innerHTML = html;
    }

    // ── Lap Times Chart ─────────────────────────────────────
    const resLaps = await fetch(`${API}/api/laps?${qs}`);
    const lData   = await resLaps.json();
    const laps    = lData.laps || [];
    currentRaceLaps = laps;
    if (laps.length) {
      // group by driver
      const byDriver = {};
      laps.forEach(l => {
        const d = l.driver || 'UNK';
        if (!byDriver[d]) byDriver[d] = [];
        const t = parseFloat(l.lap_time_sec || 0);
        if (t > 0 && t < 200) byDriver[d].push({ lap: l.lap_number, time: t });
      });
      const drivers = Object.keys(byDriver).slice(0, 6);
      const traces  = drivers.map(d => {
        byDriver[d].sort((a, b) => a.lap - b.lap);
        return {
          x: byDriver[d].map(p => p.lap),
          y: byDriver[d].map(p => p.time),
          name: d,
          mode: 'lines',
          line: { width: 1.5, color: teamColors[d] || undefined }
        };
      });
      Plotly.newPlot('chartLapTimes', traces,
        cloneLayout({ xaxis:{ title:'Lap' }, yaxis:{ title:'Lap Time (s)' } }), PLOT_CFG);

      // ── Position Chart ──────────────────────────────────
      const byDriverPos = {};
      laps.forEach(l => {
        const d = l.driver || 'UNK';
        if (!byDriverPos[d]) byDriverPos[d] = [];
        if (l.position !== null && l.position !== undefined && l.position > 0) {
          byDriverPos[d].push({ lap: l.lap_number, pos: l.position });
        }
      });

      // Find final positions to sort drivers so we can make top 10 visible by default
      const finalPositions = {};
      laps.forEach(l => {
        const d = l.driver || 'UNK';
        if (l.position > 0) {
          if (!finalPositions[d] || l.lap_number > finalPositions[d].lap) {
            finalPositions[d] = { lap: l.lap_number, pos: l.position };
          }
        }
      });

      const driversPo = Object.keys(byDriverPos);
      driversPo.sort((a, b) => {
        const posA = finalPositions[a] ? finalPositions[a].pos : 99;
        const posB = finalPositions[b] ? finalPositions[b].pos : 99;
        return posA - posB;
      });

      const posTraces = driversPo.map((d, index) => {
        byDriverPos[d].sort((a, b) => a.lap - b.lap);
        return {
          x: byDriverPos[d].map(p => p.lap),
          y: byDriverPos[d].map(p => p.pos),
          name: d,
          mode: 'lines',
          line: { width: 1.5, color: teamColors[d] || undefined },
          visible: index < 10 ? true : 'legendonly'
        };
      });
      Plotly.newPlot('chartPositions', posTraces,
        cloneLayout({
          yaxis: { title: 'Position', autorange: 'reversed', dtick: 2 },
          xaxis: { title: 'Lap' },
          legend: { orientation: 'v', x: 1.02, y: 1, xanchor: 'left', yanchor: 'top' },
          margin: { r: 95 }
        }), PLOT_CFG);
    }

    // ── Speed Traps ─────────────────────────────────────────
    const resSpeed = await fetch(`${API}/api/speed-traps?${qs}`);
    const spData   = await resSpeed.json();
    const speed    = spData.speed_traps || [];
    if (speed.length) {
      const top10 = speed.slice(0, 10);
      const cats  = top10.map(s => s.driver);
      const keys  = [
        { label: 'I1', field: 'max_speed_i1' },
        { label: 'I2', field: 'max_speed_i2' },
        { label: 'FL', field: 'max_speed_fl' },
        { label: 'ST', field: 'max_speed_st' }
      ];
      const colors = ['#e74c3c','#e67e22','#2ecc71','#3498db'];
      const sTraces = keys.map((k, i) => ({
        y: cats,
        x: top10.map(s => s[k.field] || 0),
        name: k.label,
        type: 'bar',
        orientation: 'h',
        marker: { color: colors[i] }
      }));
      Plotly.newPlot('chartSpeedTraps', sTraces,
        cloneLayout({ barmode:'group', yaxis:{ autorange:'reversed' }, xaxis:{ title:'Speed (km/h)' } }), PLOT_CFG);
    }

    // ── Grid vs Finish ──────────────────────────────────────
    const resGvf = await fetch(`${API}/api/grid-vs-finish?${qs}`);
    const gvfData = await resGvf.json();
    const gvf    = gvfData.grid_vs_finish || [];
    if (gvf.length) {
      const gTraces = [];
      gvf.forEach(d => {
        const grid   = d.grid;
        const finish = d.finish;
        const gained = finish < grid;
        const color  = gained ? '#2ecc71' : finish > grid ? '#e74c3c' : '#888';
        const driver = d.driver || '';
        gTraces.push({
          y: [driver, driver],
          x: [grid, finish],
          mode: 'lines+markers',
          line: { color, width: 2 },
          marker: { size: 6, color },
          showlegend: false,
          hoverinfo: 'text',
          text: [`Grid: ${grid}`, `Finish: ${finish}`]
        });
      });
      Plotly.newPlot('chartGridVsFinish', gTraces,
        cloneLayout({ xaxis:{ title:'Position', dtick:1 }, yaxis:{ autorange:'reversed' }, showlegend:false }), PLOT_CFG);
    }

    loadedViews.race = true;
  } catch (e) { console.error('loadRaceData', e); }
  hideLoad();
}

// ═══════════════════════════════════════════════════════════════
//  VIEW 2 — STRATEGY
// ═══════════════════════════════════════════════════════════════
async function loadStrategyData() {
  const year = selVal('selYear');
  const race = selVal('selRace');
  const session = selVal('selSession') || 'R';
  const qs   = `year=${year}&race=${race}&session_type=${session}`;

  const stratGrid = document.querySelector('#view-strategy .strat-grid');
  if (isEventInFuture(race)) {
    if (stratGrid) stratGrid.style.display = 'none';
    loadedViews.strategy = true;
    hideLoad();
    return;
  } else {
    if (stratGrid) stratGrid.style.display = 'flex';
  }

  showLoad('Loading strategy data…');

  try {
    // ── Tyre Strategy (Stint Gantt) ─────────────────────────
    const resTyre  = await fetch(`${API}/api/tyre-strategy?${qs}`);
    const tyreWrap = await resTyre.json();
    const tyreData = tyreWrap.stints || [];
    if (tyreData.length) {
      const drivers = [...new Set(tyreData.map(s => s.driver))];
      const traces  = [];
      tyreData.forEach(s => {
        const drv      = s.driver || '';
        const compound = (s.compound || 'UNKNOWN').toUpperCase();
        const start    = s.start_lap || 0;
        const end      = s.end_lap || start;
        const len      = s.stint_length || (end - start) || 1;
        traces.push({
          y: [drv],
          x: [len],
          name: compound,
          type: 'bar',
          orientation: 'h',
          base: [start],
          marker: { color: TYRE_COLORS[compound] || TYRE_COLORS.UNKNOWN },
          showlegend: false,
          hovertemplate: `${drv}: ${compound}<br>Laps ${start}–${end}<extra></extra>`
        });
      });
      // legend entries
      const compounds = [...new Set(tyreData.map(s => (s.compound || 'UNKNOWN').toUpperCase()))];
      compounds.forEach(c => {
        traces.push({ y:[null], x:[null], name:c, type:'bar', orientation:'h',
                      marker:{ color: TYRE_COLORS[c] || TYRE_COLORS.UNKNOWN }, showlegend:true });
      });
      Plotly.newPlot('chartStints', traces,
        cloneLayout({ barmode:'stack', xaxis:{ title:'Lap' }, yaxis:{ autorange:'reversed' }, showlegend:true }), PLOT_CFG);
    }

    // ── Weather ─────────────────────────────────────────────
    const resW    = await fetch(`${API}/api/weather?${qs}`);
    const wWrap   = await resW.json();
    const wData   = wWrap.weather || [];
    if (wData.length) {
      const xAxis = wData.map((w, i) => w.time_sec || i);
      const trW = [
        { x: xAxis, y: wData.map(w => w.air_temp), name: 'Air Temp (°C)', line:{ color:'#e74c3c' } },
        { x: xAxis, y: wData.map(w => w.track_temp), name: 'Track Temp (°C)', line:{ color:'#e67e22' } },
        { x: xAxis, y: wData.map(w => w.humidity), name: 'Humidity (%)', yaxis:'y2', line:{ color:'#3498db', dash:'dot' } }
      ];
      Plotly.newPlot('chartWeather', trW,
        cloneLayout({
          xaxis:{ title:'Time (s)' },
          yaxis:{ title:'Temperature (°C)' },
          yaxis2:{ title:'Humidity (%)', overlaying:'y', side:'right', showgrid:false, gridcolor:'rgba(255,255,255,0.04)', font:{ color:'#3498db' } }
        }), PLOT_CFG);
    }

    // ── Track Evolution ─────────────────────────────────────
    const resTE   = await fetch(`${API}/api/track-evolution?${qs}`);
    const teWrap  = await resTE.json();
    const teData  = teWrap.evolution || [];
    if (teData.length) {
      const trTE = [
        { x: teData.map(t => t.lap_number), y: teData.map(t => t.fastest),
          name:'Fastest', mode:'lines', line:{ color:'#9b59b6', width:2 } },
        { x: teData.map(t => t.lap_number), y: teData.map(t => t.median),
          name:'Median', mode:'lines', line:{ color:'#7f8c8d', width:1, dash:'dot' } }
      ];
      Plotly.newPlot('chartTrackEvolution', trTE,
        cloneLayout({ xaxis:{ title:'Lap Number' }, yaxis:{ title:'Lap Time (s)' } }), PLOT_CFG);
    }

    loadedViews.strategy = true;
  } catch (e) { console.error('loadStrategyData', e); }
  hideLoad();
}

// ═══════════════════════════════════════════════════════════════
//  VIEW 3 — ANALYSIS
// ═══════════════════════════════════════════════════════════════
async function loadAnalysisData() {
  const year = selVal('selYear');
  const race = selVal('selRace');
  const session = selVal('selSession') || 'R';
  const qs   = `year=${year}&race=${race}&session_type=${session}`;

  const analysisGrid = document.querySelector('#view-analysis .analysis-grid');
  if (isEventInFuture(race)) {
    if (analysisGrid) analysisGrid.style.display = 'none';
    loadedViews.analysis = true;
    hideLoad();
    return;
  } else {
    if (analysisGrid) analysisGrid.style.display = 'grid';
  }

  showLoad('Loading analysis data…');

  try {
    // ── Fastest Laps Table ──────────────────────────────────
    const resFL  = await fetch(`${API}/api/fastest-laps?${qs}`);
    const flWrap = await resFL.json();
    const flData = flWrap.fastest_laps || [];
    const tbl3   = document.getElementById('fastestLapsTable');
    if (tbl3 && flData.length) {
      let html = `<table><thead><tr>
        <th>POS</th><th>DRIVER</th><th>TEAM</th><th>BEST LAP</th><th>S1</th><th>S2</th><th>S3</th><th>TYRE</th>
      </tr></thead><tbody>`;

      flData.forEach((f, i) => {
        const clsL = f.is_purple_lap ? 'time-purple' : '';
        const cls1 = f.is_purple_s1 ? 'time-purple' : '';
        const cls2 = f.is_purple_s2 ? 'time-purple' : '';
        const cls3 = f.is_purple_s3 ? 'time-purple' : '';
        const compound = (f.compound || '').toUpperCase();
        html += `<tr>
          <td>${i + 1}</td>
          <td>${f.driver || '-'}</td>
          <td>${f.team || '-'}</td>
          <td class="${clsL}">${fmtLap(f.best_lap)}</td>
          <td class="${cls1}">${fmtLap(f.best_s1)}</td>
          <td class="${cls2}">${fmtLap(f.best_s2)}</td>
          <td class="${cls3}">${fmtLap(f.best_s3)}</td>
          <td><span class="tyre-badge" style="background:${TYRE_COLORS[compound] || TYRE_COLORS.UNKNOWN}">${compound.charAt(0) || '?'}</span></td>
        </tr>`;
      });
      html += '</tbody></table>';
      tbl3.innerHTML = html;
    }

    // ── Pit Stops Table ─────────────────────────────────────
    const resPS  = await fetch(`${API}/api/pit-stops?${qs}`);
    const psWrap = await resPS.json();
    const psData = psWrap.pit_stops || [];
    const tbl4   = document.getElementById('pitStopsTable');
    if (tbl4 && psData.length) {
      const sorted = [...psData].sort((a, b) => (a.lap || 0) - (b.lap || 0));
      let html = `<table><thead><tr>
        <th>LAP</th><th>DRIVER</th><th>STOP</th><th>DURATION</th><th>COMPOUND</th>
      </tr></thead><tbody>`;
      sorted.forEach(p => {
        const from = (p.compound_from || '').toUpperCase();
        const to   = (p.compound_to || '').toUpperCase();
        html += `<tr>
          <td>${p.lap ?? '-'}</td>
          <td>${p.driver || '-'}</td>
          <td>${p.stop ?? '-'}</td>
          <td>${p.duration != null ? p.duration + 's' : '-'}</td>
          <td>
            <span class="tyre-badge" style="background:${TYRE_COLORS[from] || TYRE_COLORS.UNKNOWN}">${from.charAt(0) || '?'}</span>
            →
            <span class="tyre-badge" style="background:${TYRE_COLORS[to] || TYRE_COLORS.UNKNOWN}">${to.charAt(0) || '?'}</span>
          </td>
        </tr>`;
      });
      html += '</tbody></table>';
      tbl4.innerHTML = html;
    }

    // ── Tyre Degradation Scatter ────────────────────────────
    const resDeg  = await fetch(`${API}/api/tyre-degradation?${qs}`);
    const degWrap = await resDeg.json();
    const degData = degWrap.degradation || [];
    if (degData.length) {
      const byComp = {};
      degData.forEach(d => {
        const c = (d.compound || 'UNKNOWN').toUpperCase();
        if (!byComp[c]) byComp[c] = { x:[], y:[] };
        byComp[c].x.push(d.tyre_life ?? 0);
        byComp[c].y.push(d.lap_time_sec ?? 0);
      });
      const dTraces = Object.keys(byComp).map(c => ({
        x: byComp[c].x, y: byComp[c].y,
        name: c, mode: 'markers',
        marker: { size: 3, color: TYRE_COLORS[c] || TYRE_COLORS.UNKNOWN }
      }));
      Plotly.newPlot('chartDegradation', dTraces,
        cloneLayout({ xaxis:{ title:'Tyre Life (laps)' }, yaxis:{ title:'Lap Time (s)' } }), PLOT_CFG);
    }

    // ── Race Pace Box Plot ──────────────────────────────────
    // Backend returns ONE object per driver with a lap_times array
    const resRP  = await fetch(`${API}/api/race-pace?${qs}`);
    const rpWrap = await resRP.json();
    const rpData = rpWrap.race_pace || [];
    if (rpData.length) {
      // Already sorted by median from the backend; take top 10
      const top10 = rpData.slice(0, 10);
      const bTraces = top10.map(d => ({
        y: d.lap_times, name: d.driver, type: 'box',
        marker: { color: teamColor(d.team_color) },
        line: { color: teamColor(d.team_color) },
        boxpoints: false
      }));
      Plotly.newPlot('chartRacePace', bTraces,
        cloneLayout({ yaxis:{ title:'Lap Time (s)' }, showlegend:false }), PLOT_CFG);
    }

    loadedViews.analysis = true;
  } catch (e) { console.error('loadAnalysisData', e); }
  hideLoad();
}

// ═══════════════════════════════════════════════════════════════
//  VIEW 4 — CHAMPIONSHIP
// ═══════════════════════════════════════════════════════════════
async function loadChampionshipData() {
  showLoad('Loading championship data…');
  const year = selVal('selYear');
  const qs   = `year=${year}`;

  try {
    // ── Driver Standings ────────────────────────────────────
    const resDS  = await fetch(`${API}/api/standings/drivers?${qs}`);
    const dsWrap = await resDS.json();
    const dsData = dsWrap.standings || [];
    const tbl5   = document.getElementById('driverStandings');
    if (tbl5 && dsData.length) {
      const maxPts = Math.max(...dsData.map(d => parseFloat(d.points || 0)), 1);
      let html = `<table><thead><tr>
        <th>POS</th><th>DRIVER</th><th>PTS</th><th></th>
      </tr></thead><tbody>`;
      dsData.forEach(d => {
        const pts = parseFloat(d.points || 0);
        const pct = (pts / maxPts * 100).toFixed(1);
        html += `<tr>
          <td>${d.position ?? '-'}</td>
          <td>${d.driverId || '-'}</td>
          <td>${pts}</td>
          <td><div class="progress-bar-bg"><div class="progress-bar" style="width:${pct}%">${pts}</div></div></td>
        </tr>`;
      });
      html += '</tbody></table>';
      tbl5.innerHTML = html;
    }

    // ── Constructor Standings ───────────────────────────────
    const resCS  = await fetch(`${API}/api/standings/constructors?${qs}`);
    const csWrap = await resCS.json();
    const csData = csWrap.standings || [];
    const tbl6   = document.getElementById('constructorStandings');
    if (tbl6 && csData.length) {
      const maxPtsC = Math.max(...csData.map(c => parseFloat(c.points || 0)), 1);
      let html = `<table><thead><tr>
        <th>POS</th><th>CONSTRUCTOR</th><th>WINS</th><th>PTS</th><th></th>
      </tr></thead><tbody>`;
      csData.forEach(c => {
        const pts = parseFloat(c.points || 0);
        const pct = (pts / maxPtsC * 100).toFixed(1);
        html += `<tr>
          <td>${c.position ?? '-'}</td>
          <td>${c.constructorName || c.constructorId || '-'}</td>
          <td>${c.wins ?? '-'}</td>
          <td>${pts}</td>
          <td><div class="progress-bar-bg"><div class="progress-bar" style="width:${pct}%">${pts}</div></div></td>
        </tr>`;
      });
      html += '</tbody></table>';
      tbl6.innerHTML = html;
    }

    // ── Points Progression ──────────────────────────────────
    // Backend returns: { progression: [{driver, points:[cumulative], total}], rounds: N }
    const resPP  = await fetch(`${API}/api/points-progression?${qs}`);
    const ppWrap = await resPP.json();
    const ppData = ppWrap.progression || [];
    const numRounds = ppWrap.rounds || 0;
    if (ppData.length) {
      const topDrivers = ppData.slice(0, 10);
      const roundLabels = Array.from({ length: numRounds }, (_, i) => i + 1);

      const pTraces = topDrivers.map(d => ({
        x: roundLabels,
        y: d.points,
        name: d.driver,
        mode: 'lines+markers',
        line: { width: 2 },
        marker: { size: 4 }
      }));
      Plotly.newPlot('chartPointsProgression', pTraces,
        cloneLayout({ xaxis:{ title:'Round', dtick:1 }, yaxis:{ title:'Cumulative Points' } }), PLOT_CFG);
    }

    // ── Teammate Comparison ─────────────────────────────────
    // Backend returns: { comparisons: [{constructor, driver1, driver2, race_h2h:{d1_wins,d2_wins}, quali_h2h:{d1_wins,d2_wins}, driver1_points, driver2_points}] }
    const resTM  = await fetch(`${API}/api/teammate-comparison?${qs}`);
    const tmWrap = await resTM.json();
    const tmData = tmWrap.comparisons || [];
    const tmEl   = document.getElementById('teammateComparison');
    if (tmEl && tmData.length) {
      tmEl.innerHTML = '';
      tmData.forEach(m => {
        const d1 = m.driver1 || '';
        const d2 = m.driver2 || '';
        const raceW1 = m.race_h2h?.d1_wins ?? 0;
        const raceW2 = m.race_h2h?.d2_wins ?? 0;
        const qualiW1 = m.quali_h2h?.d1_wins ?? 0;
        const qualiW2 = m.quali_h2h?.d2_wins ?? 0;
        const pts1 = m.driver1_points ?? 0;
        const pts2 = m.driver2_points ?? 0;
        const total = (raceW1 + raceW2) || 1;
        const pctL  = (raceW1 / total * 100).toFixed(0);
        const pctR  = (raceW2 / total * 100).toFixed(0);

        const card = document.createElement('div');
        card.className = 'h2h-card';
        card.innerHTML = `
          <div class="h2h-team">${m.constructor || ''}</div>
          <div class="h2h-drivers">${d1} <span class="h2h-vs">VS</span> ${d2}</div>
          <div class="h2h-row"><span>Race H2H</span><span>${raceW1} – ${raceW2}</span></div>
          <div class="h2h-row"><span>Quali H2H</span><span>${qualiW1} – ${qualiW2}</span></div>
          <div class="h2h-row"><span>Points</span><span>${pts1} – ${pts2}</span></div>
          <div class="h2h-bar-container">
            <div class="h2h-bar-left" style="width:${pctL}%">${d1}</div>
            <div class="h2h-bar-right" style="width:${pctR}%">${d2}</div>
          </div>`;
        tmEl.appendChild(card);
      });
    }

    if (dsData && dsData.length) {
      populateChampionshipDrivers(dsData);
    }

    loadedViews.championship = true;
  } catch (e) { console.error('loadChampionshipData', e); }
  hideLoad();
}

// ═══════════════════════════════════════════════════════════════
//  VIEW 5 — TELEMETRY
// ═══════════════════════════════════════════════════════════════
async function loadTelemetry() {
  showLoad('Loading telemetry…');
  const year = selVal('selYear');
  const race = selVal('selRace');
  const dr1  = selVal('selDr1');
  const dr2  = selVal('selDr2');
  const lap1 = selVal('selLap1') || 'fastest';
  const lap2 = selVal('selLap2') || 'fastest';
  const session = selVal('selSession') || 'R';
  const qs   = `year=${year}&race=${race}&driver1=${dr1}&driver2=${dr2}&lap1=${lap1}&lap2=${lap2}&session_type=${session}`;

  try {
    const res  = await fetch(`${API}/compare?${qs}`);
    const data = await res.json();
    if (!data) { hideLoad(); return; }

    // /compare returns flat arrays: distance[], speed1[], speed2[], delta[], etc.
    const dist      = data.distance || [];
    const speed1    = data.speed1 || [];
    const speed2    = data.speed2 || [];
    const deltaArr  = data.delta || [];
    const throttle1 = data.throttle1 || [];
    const throttle2 = data.throttle2 || [];
    const brake1    = data.brake1 || [];
    const brake2    = data.brake2 || [];
    const gear1     = data.gear1 || [];
    const gear2     = data.gear2 || [];
    const rpm1      = data.rpm1 || [];
    const rpm2      = data.rpm2 || [];
    const drs1      = data.drs1 || [];
    const drs2      = data.drs2 || [];
    const x1Pos     = data.x1 || [];
    const y1Pos     = data.y1 || [];
    const x2Pos     = data.x2 || [];
    const y2Pos     = data.y2 || [];
    const speedMap  = data.speed_map || speed1;
    const sectors   = data.sectors || [];
    const sectorDist = data.sector_distances || [];

    const n1 = data.driver1 || dr1;
    const n2 = data.driver2 || dr2;
    const c1 = data.driver1_color || '#00d2be';
    const c2 = data.driver2_color || '#ff8700';

    // color bars
    const cb1 = document.getElementById('dr1ColorBar');
    const cb2 = document.getElementById('dr2ColorBar');
    if (cb1) cb1.style.background = c1;
    if (cb2) cb2.style.background = c2;

    // Sector shapes
    const shapes = sectorDist.length >= 2
      ? sectorShapes(sectorDist[0], sectorDist[1], dist[dist.length - 1] || 5000)
      : [];

    // ── Speed Chart ─────────────────────────────────────────
    Plotly.newPlot('chartSpeed', [
      { x: dist, y: speed1, name: n1, mode: 'lines', line: { color: c1, width: 1.5 } },
      { x: dist, y: speed2, name: n2, mode: 'lines', line: { color: c2, width: 1.5 } }
    ], cloneLayout({ yaxis: { title: 'Speed (km/h)' }, shapes }), PLOT_CFG);

    // ── Delta Chart ─────────────────────────────────────────
    Plotly.newPlot('chartDelta', [
      { x: dist, y: deltaArr, name: 'Delta', fill: 'tozeroy', mode: 'lines',
        line: { color: '#fff', width: 1 },
        fillcolor: 'rgba(255,255,255,0.1)' }
    ], cloneLayout({ yaxis: { title: 'Delta (s)', zeroline: true, zerolinecolor: '#fff' }, shapes }), PLOT_CFG);

    // ── RPM Chart ───────────────────────────────────────────
    Plotly.newPlot('chartRPM', [
      { x: dist, y: rpm1, name: n1, mode: 'lines', line: { color: c1, width: 1.5 } },
      { x: dist, y: rpm2, name: n2, mode: 'lines', line: { color: c2, width: 1.5 } }
    ], cloneLayout({ yaxis: { title: 'RPM' }, shapes }), PLOT_CFG);

    // ── Gear Chart ──────────────────────────────────────────
    Plotly.newPlot('chartGear', [
      { x: dist, y: gear1, name: n1, mode: 'lines', line: { color: c1, width: 1.5, shape: 'hv' } },
      { x: dist, y: gear2, name: n2, mode: 'lines', line: { color: c2, width: 1.5, shape: 'hv' } }
    ], cloneLayout({ yaxis: { title: 'Gear', dtick: 1, range: [0, 9] }, shapes }), PLOT_CFG);

    // ── Throttle & Brake Chart ──────────────────────────────
    Plotly.newPlot('chartInputs', [
      { x: dist, y: throttle1, name: n1 + ' Throttle', mode: 'lines', line: { color: c1, width: 1 } },
      { x: dist, y: throttle2, name: n2 + ' Throttle', mode: 'lines', line: { color: c2, width: 1 } },
      { x: dist, y: brake1.map(v => v * 100), name: n1 + ' Brake', mode: 'lines', line: { color: c1, width: 1, dash: 'dot' } },
      { x: dist, y: brake2.map(v => v * 100), name: n2 + ' Brake', mode: 'lines', line: { color: c2, width: 1, dash: 'dot' } }
    ], cloneLayout({ yaxis: { title: 'Input (%)' }, shapes }), PLOT_CFG);

    // ── DRS Chart ───────────────────────────────────────────
    Plotly.newPlot('chartDRS', [
      { x: dist, y: drs1, name: n1, mode: 'lines', line: { color: c1, width: 1.5, shape: 'hv' } },
      { x: dist, y: drs2, name: n2, mode: 'lines', line: { color: c2, width: 1.5, shape: 'hv' } }
    ], cloneLayout({ yaxis: { title: 'DRS' }, shapes }), PLOT_CFG);

    // ── Track Map ───────────────────────────────────────────
    Plotly.newPlot('chartTrack', [
      {
        x: x1Pos,
        y: y1Pos,
        mode: 'markers',
        marker: {
          size: 2,
          color: speedMap,
          colorscale: 'Jet',
          showscale: true,
          colorbar: { title: 'km/h', thickness: 10, len: 0.5 }
        },
        name: n1,
        hovertemplate: 'Speed: %{marker.color} km/h<extra></extra>'
      },
      // Trace 1: Driver 1 Position Marker
      {
        x: [],
        y: [],
        mode: 'markers',
        marker: {
          size: 10,
          color: c1,
          symbol: 'circle',
          line: { color: '#ffffff', width: 2 }
        },
        name: n1,
        showlegend: false,
        hoverinfo: 'none'
      },
      // Trace 2: Driver 2 Position Marker
      {
        x: [],
        y: [],
        mode: 'markers',
        marker: {
          size: 10,
          color: c2,
          symbol: 'circle',
          line: { color: '#ffffff', width: 2 }
        },
        name: n2,
        showlegend: false,
        hoverinfo: 'none'
      }
    ], cloneLayout({
      xaxis: { visible: false, scaleanchor: 'y' },
      yaxis: { visible: false },
      showlegend: false,
      margin: { t: 10, r: 10, b: 10, l: 10 }
    }), PLOT_CFG);

    // ── Sector Delta Table ──────────────────────────────────
    const stEl = document.getElementById('sectorTable');
    if (stEl && sectors.length >= 3) {
      let html = `<table><thead><tr>
        <th>Sector</th><th>Delta (s)</th>
      </tr></thead><tbody>`;
      sectors.forEach((s, i) => {
        const color = s < 0 ? '#2ecc71' : '#e74c3c';
        html += `<tr>
          <td>S${i + 1}</td>
          <td style="color:${color}">${s.toFixed(3)}s</td>
        </tr>`;
      });
      // Overall
      const overall = sectors.reduce((a, b) => a + b, 0);
      const oColor = overall < 0 ? '#2ecc71' : '#e74c3c';
      html += `<tr>
        <td><strong>Total</strong></td>
        <td style="color:${oColor}"><strong>${overall.toFixed(3)}s</strong></td>
      </tr>`;
      html += '</tbody></table>';
      stEl.innerHTML = html;
    }

    // ── Synchronized Hover ──────────────────────────────────
    const syncCharts = ['chartSpeed','chartDelta','chartRPM','chartGear','chartInputs','chartDRS'];
    syncCharts.forEach(srcId => {
      const srcEl = document.getElementById(srcId);
      if (!srcEl) return;
      srcEl.on('plotly_hover', (evData) => {
        if (!evData || !evData.points || !evData.points.length) return;
        const xVal = evData.points[0].x;
        syncCharts.forEach(tgtId => {
          if (tgtId === srcId) return;
          const tgtEl = document.getElementById(tgtId);
          if (tgtEl) Plotly.Fx.hover(tgtId, [{ curveNumber: 0, xval: xVal }]);
        });
        // move track marker
        const trackEl = document.getElementById('chartTrack');
        if (trackEl && dist.length) {
          const idx = dist.findIndex(d => d >= xVal);
          if (idx >= 0) {
            Plotly.Fx.hover('chartTrack', [{ curveNumber: 0, pointNumber: idx }]);
            // update tracking marker coordinates
            Plotly.restyle('chartTrack', {
              x: [[x1Pos[idx]], [x2Pos[idx] || x1Pos[idx]]],
              y: [[y1Pos[idx]], [y2Pos[idx] || y1Pos[idx]]]
            }, [1, 2]);
          }
        }
      });
      srcEl.on('plotly_unhover', () => {
        syncCharts.forEach(tgtId => {
          if (tgtId !== srcId) Plotly.Fx.unhover(tgtId);
        });
        Plotly.Fx.unhover('chartTrack');
        Plotly.restyle('chartTrack', {
          x: [[], []],
          y: [[], []]
        }, [1, 2]);
      });
    });

    await load3DTrack();

    loadedViews.telemetry = true;
  } catch (e) { console.error('loadTelemetry', e); }
  hideLoad();
}


async function load3DTrack() {
  const year = selVal('selYear');
  const race = selVal('selRace');
  const session = selVal('selSession') || 'R';
  const track3dEl = document.getElementById('chartTrack3d');
  if (!track3dEl) return;

  try {
    const res = await fetch(`${API}/track/3d?year=${year}&race=${race}&session_type=${session}`);
    const data = await res.json();
    if (!data || !data.x || !data.x.length) {
      track3dEl.innerHTML = '<div class="empty-state">No elevation data available for this session</div>';
      return;
    }

    const x = data.x;
    const y = data.y;
    const z = data.z;

    Plotly.newPlot('chartTrack3d', [{
      type: 'scatter3d',
      mode: 'lines',
      x: x,
      y: y,
      z: z,
      line: {
        width: 6,
        color: z,
        colorscale: 'Turbo',
        showscale: false
      },
      hovertemplate: 'Elevation: %{z}m<extra></extra>'
    }], {
      plot_bgcolor: 'transparent',
      paper_bgcolor: 'transparent',
      font: { color: '#8888a0', family: 'Inter', size: 10 },
      margin: { t: 0, r: 0, b: 0, l: 0 },
      scene: {
        xaxis: { visible: false, showgrid: false },
        yaxis: { visible: false, showgrid: false },
        zaxis: { visible: false, showgrid: false },
        camera: {
          eye: { x: 1.5, y: 1.5, z: 1.2 }
        }
      },
      showlegend: false
    }, PLOT_CFG);
  } catch (e) {
    console.error('load3DTrack error', e);
    track3dEl.innerHTML = '<div class="empty-state">Failed to load 3D elevation map</div>';
  }
}

function populateChampionshipDrivers(standings) {
  const sel1 = document.getElementById('selCompDr1');
  const sel2 = document.getElementById('selCompDr2');
  if (!sel1 || !sel2) return;
  
  const current1 = sel1.value;
  const current2 = sel2.value;
  
  sel1.innerHTML = '';
  sel2.innerHTML = '';
  
  const sorted = [...standings].sort((a, b) => a.driverId.localeCompare(b.driverId));
  
  sorted.forEach(d => {
    const o1 = document.createElement('option');
    o1.value = d.driverId;
    o1.textContent = d.driverId.toUpperCase();
    sel1.appendChild(o1);
    
    const o2 = document.createElement('option');
    o2.value = d.driverId;
    o2.textContent = d.driverId.toUpperCase();
    sel2.appendChild(o2);
  });
  
  if (current1 && sorted.some(d => d.driverId === current1)) sel1.value = current1;
  else if (sorted.length > 0) sel1.value = sorted[0].driverId;
  
  if (current2 && sorted.some(d => d.driverId === current2)) sel2.value = current2;
  else if (sorted.length > 1) sel2.value = sorted[1].driverId;
}

async function compareDriversSeason() {
  const dr1 = selVal('selCompDr1');
  const dr2 = selVal('selCompDr2');
  if (!dr1 || !dr2) return;
  
  const year = selVal('selYear');
  const container = document.getElementById('customDriverComparison');
  if (!container) return;
  
  container.innerHTML = '<div class="empty-state">Calculating season H2H stats (fetching completed races)…</div>';
  
  try {
    const res = await fetch(`${API}/api/compare-drivers?year=${year}&driver1=${dr1}&driver2=${dr2}`);
    const data = await res.json();
    if (data.status === 'error') {
      container.innerHTML = `<div class="empty-state" style="color:var(--accent);">Error: ${data.message}</div>`;
      return;
    }
    
    const d1 = data.driver1;
    const d2 = data.driver2;
    const h2h = data.h2h;
    
    const totalPoints = (d1.points + d2.points) || 1;
    const pctPts1 = (d1.points / totalPoints * 100).toFixed(0);
    const pctPts2 = (d2.points / totalPoints * 100).toFixed(0);
    
    const g1 = d1.avg_grid || 20;
    const g2 = d2.avg_grid || 20;
    const totalGrid = g1 + g2 || 1;
    const pctGrid1 = ((1 - g1 / totalGrid) * 100).toFixed(0);
    const pctGrid2 = ((1 - g2 / totalGrid) * 100).toFixed(0);
    
    const f1 = d1.avg_finish || 20;
    const f2 = d2.avg_finish || 20;
    const totalFinish = f1 + f2 || 1;
    const pctFinish1 = ((1 - f1 / totalFinish) * 100).toFixed(0);
    const pctFinish2 = ((1 - f2 / totalFinish) * 100).toFixed(0);
    
    const totalH2H = (h2h.d1_ahead + h2h.d2_ahead) || 1;
    const pctH2H1 = (h2h.d1_ahead / totalH2H * 100).toFixed(0);
    const pctH2H2 = (h2h.d2_ahead / totalH2H * 100).toFixed(0);
    
    container.innerHTML = `
      <div class="h2h-card">
        <div class="h2h-drivers" style="font-size: 1.1rem; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 8px; margin-bottom: 12px;">
          ${d1.code} <span class="h2h-vs" style="font-size:0.8rem;">VS</span> ${d2.code}
        </div>
        
        <div class="h2h-row"><span>Season Points</span><span>${d1.points} vs ${d2.points}</span></div>
        <div class="h2h-bar-container">
          <div class="h2h-bar-left" style="width:${pctPts1}%">${d1.code}</div>
          <div class="h2h-bar-right" style="width:${pctPts2}%">${d2.code}</div>
        </div>
        
        <div class="h2h-row" style="margin-top: 10px;"><span>Avg Grid Position</span><span>${d1.avg_grid ? d1.avg_grid.toFixed(2) : '-'} vs ${d2.avg_grid ? d2.avg_grid.toFixed(2) : '-'}</span></div>
        <div class="h2h-bar-container">
          <div class="h2h-bar-left" style="width:${pctGrid1}%">${d1.code}</div>
          <div class="h2h-bar-right" style="width:${pctGrid2}%">${d2.code}</div>
        </div>
        
        <div class="h2h-row" style="margin-top: 10px;"><span>Avg Finish Position</span><span>${d1.avg_finish ? d1.avg_finish.toFixed(2) : '-'} vs ${d2.avg_finish ? d2.avg_finish.toFixed(2) : '-'}</span></div>
        <div class="h2h-bar-container">
          <div class="h2h-bar-left" style="width:${pctFinish1}%">${d1.code}</div>
          <div class="h2h-bar-right" style="width:${pctFinish2}%">${d2.code}</div>
        </div>
        
        <div class="h2h-row" style="margin-top: 10px;"><span>Finishing Ahead H2H</span><span>${h2h.d1_ahead} rounds vs ${h2h.d2_ahead} rounds</span></div>
        <div class="h2h-bar-container">
          <div class="h2h-bar-left" style="width:${pctH2H1}%">${d1.code}</div>
          <div class="h2h-bar-right" style="width:${pctH2H2}%">${d2.code}</div>
        </div>
        
        <div class="h2h-row" style="margin-top: 12px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 8px;">
          <span>Race Wins</span>
          <span><strong>${d1.wins} – ${d2.wins}</strong></span>
        </div>
        <div class="h2h-row">
          <span>Podiums</span>
          <span><strong>${d1.podiums} – ${d2.podiums}</strong></span>
        </div>
        <div class="h2h-row">
          <span>DNFs</span>
          <span><strong>${d1.dnfs} – ${d2.dnfs}</strong></span>
        </div>
      </div>
    `;
  } catch (e) {
    console.error('compareDriversSeason error', e);
    container.innerHTML = '<div class="empty-state" style="color:var(--accent);">Failed to compute comparison.</div>';
  }
}

// Bind the compare button / selDr changes
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btnCompare') || document.getElementById('btnTelemetry') || document.getElementById('btnAnalyze');
  if (btn) btn.addEventListener('click', () => { loadedViews.telemetry = false; loadTelemetry(); });

  const btnComp = document.getElementById('btnCompareDrivers');
  if (btnComp) btnComp.addEventListener('click', compareDriversSeason);
});

// ═══════════════════════════════════════════════════════════════
//  VIEW 6 — LIVE (OpenF1)
// ═══════════════════════════════════════════════════════════════
let liveDriverMap  = {};
let liveSessionKey = null;

async function initLiveView() {
  showLoad('Connecting to live session…');
  try {
    // clear previous polling
    if (livePollingInterval) { clearInterval(livePollingInterval); livePollingInterval = null; }

    const bn = document.getElementById('bannerSessionName');
    const bm = document.getElementById('bannerMeta');
    const bs = document.getElementById('bannerStatus');

    let session = {};
    try {
      const res     = await fetch(`${API}/api/live/session`);
      const sesWrap = await res.json();
      session = sesWrap.session || {};
    } catch (err) {
      console.warn('Failed to fetch live session info:', err);
    }

    liveSessionKey = session.session_key || null;

    if (!liveSessionKey) {
      if (bn) bn.textContent = 'No Active Live Session';
      if (bm) bm.textContent = 'Unable to connect to OpenF1 live data feed.';
      if (bs) { bs.textContent = 'OFFLINE'; bs.classList.remove('live'); }
      hideLoad();
      return;
    }

    // banner
    if (bn) bn.textContent = session.session_name || session.circuit_short_name || 'Live Session';
    if (bm) bm.textContent = `${session.session_type || ''} · ${session.date_start || ''}`;
    if (bs) { bs.textContent = 'LIVE'; bs.classList.add('live'); }

    // drivers
    let drivers = [];
    try {
      const dRes    = await fetch(`${API}/api/live/drivers?session_key=${liveSessionKey}`);
      const dWrap   = await dRes.json();
      drivers = dWrap.drivers || [];
    } catch (err) {
      console.warn('Failed to fetch live drivers:', err);
    }

    liveDriverMap = {};
    drivers.forEach(d => {
      const num = d.driver_number || d.number;
      liveDriverMap[num] = {
        name: d.name_acronym || d.abbreviation || d.name || '',
        full: d.full_name || d.broadcast_name || '',
        team: d.team_name || '',
        color: d.team_colour || d.team_color || '888'
      };
    });

    await pollLiveData();
    livePollingInterval = setInterval(pollLiveData, 15000);
    loadedViews.live = true;
  } catch (e) { console.error('initLiveView', e); }
  hideLoad();
}

async function pollLiveData() {
  if (!liveSessionKey) return;
  const sk = `session_key=${liveSessionKey}`;
  try {
    const [posWrap, lapWrap, intWrap, rcWrap, wxWrap, pitWrap, radioWrap, stintWrap] = await Promise.all([
      fetch(`${API}/api/live/positions?${sk}`).then(r => r.json()).catch(() => ({})),
      fetch(`${API}/api/live/laps?${sk}`).then(r => r.json()).catch(() => ({})),
      fetch(`${API}/api/live/intervals?${sk}`).then(r => r.json()).catch(() => ({})),
      fetch(`${API}/api/live/race-control?${sk}`).then(r => r.json()).catch(() => ({})),
      fetch(`${API}/api/live/weather?${sk}`).then(r => r.json()).catch(() => ({})),
      fetch(`${API}/api/live/pit?${sk}`).then(r => r.json()).catch(() => ({})),
      fetch(`${API}/api/live/team-radio?${sk}`).then(r => r.json()).catch(() => ({})),
      fetch(`${API}/api/live/stints?${sk}`).then(r => r.json()).catch(() => ({}))
    ]);

    renderLiveTimingBoard(posWrap.positions || [], lapWrap.laps || [], intWrap.intervals || [], stintWrap.stints || []);
    renderRaceControlFeed(rcWrap.messages || []);
    renderLiveWeather(wxWrap.weather || []);
    renderPitActivity(pitWrap.pits || []);
    renderTeamRadio(radioWrap.radio || []);
  } catch (e) { console.error('pollLiveData', e); }
}

// ── Live: Timing Board ──────────────────────────────────────
function renderLiveTimingBoard(positions, laps, intervals, stints) {
  const el = document.getElementById('liveTimingBoard');
  if (!el) return;

  // latest position per driver (using chronological date comparison)
  const latestPos = {};
  (positions || []).forEach(p => {
    const num = p.driver_number || p.DriverNumber;
    const currentD = latestPos[num]?.date || '';
    const thisD = p.date || '';
    if (thisD >= currentD) {
      latestPos[num] = p;
    }
  });

  // latest lap per driver (using lap_number comparison)
  const latestLap = {};
  (laps || []).forEach(l => {
    const num = l.driver_number || l.DriverNumber;
    const currentMax = latestLap[num]?.lap_number || latestLap[num]?.LapNumber || -1;
    const thisLapNum = l.lap_number || l.LapNumber || 0;
    if (thisLapNum >= currentMax) {
      latestLap[num] = l;
    }
  });

  // latest interval per driver (using chronological date comparison)
  const latestInt = {};
  (intervals || []).forEach(iv => {
    const num = iv.driver_number || iv.DriverNumber;
    const currentD = latestInt[num]?.date || '';
    const thisD = iv.date || '';
    if (thisD >= currentD) {
      latestInt[num] = iv;
    }
  });

  // latest stint per driver (using stint_number comparison)
  const latestStint = {};
  (stints || []).forEach(s => {
    const num = s.driver_number || s.DriverNumber;
    const currentMax = latestStint[num]?.stint_number || latestStint[num]?.StintNumber || -1;
    const thisStintNum = s.stint_number || s.StintNumber || 0;
    if (thisStintNum >= currentMax) {
      latestStint[num] = s;
    }
  });

  // build rows
  let driverNums = [...new Set(Object.keys(latestPos))];
  if (driverNums.length === 0) {
    driverNums = Object.keys(liveDriverMap);
  }

  const rows = driverNums.map(num => {
    const pos  = latestPos[num];
    const lap  = latestLap[num];
    const iv   = latestInt[num];
    const st   = latestStint[num];
    const info = liveDriverMap[num] || { name: num, team: '', color: '888' };
    return {
      position : pos?.position || pos?.Position || '-',
      driver   : info.name || num,
      team     : info.team,
      color    : info.color,
      interval : iv?.interval !== undefined ? iv.interval : '-',
      gap      : iv?.gap_to_leader !== undefined ? iv.gap_to_leader : '-',
      lastLap  : lap?.lap_duration || lap?.LapDuration || lap?.last_lap_time || '-',
      compound : (st?.compound || st?.Compound || '').toUpperCase(),
      lapCount : lap?.lap_number || lap?.LapNumber || '-'
    };
  });

  // best lap per driver
  const bestPerDriver = {};
  (laps || []).forEach(l => {
    const num = l.driver_number || l.DriverNumber;
    const dur = parseFloat(l.lap_duration || l.LapDuration || Infinity);
    if (!bestPerDriver[num] || dur < bestPerDriver[num]) bestPerDriver[num] = dur;
  });

  rows.sort((a, b) => {
    const posA = typeof a.position === 'number' ? a.position : (parseInt(a.position) || 999);
    const posB = typeof b.position === 'number' ? b.position : (parseInt(b.position) || 999);
    return posA - posB;
  });

  let html = `<table><thead><tr>
    <th>POS</th><th>DRIVER</th><th>INT</th><th>GAP</th><th>LAST</th><th>BEST</th><th>TYRE</th><th>LAP</th>
  </tr></thead><tbody>`;
  rows.forEach(r => {
    const tyreCol = TYRE_COLORS[r.compound] || TYRE_COLORS.UNKNOWN;
    // Find best by driver name mapping
    let best = '-';
    for (const [num, info] of Object.entries(liveDriverMap)) {
      if (info.name === r.driver && bestPerDriver[num] !== undefined) {
        best = bestPerDriver[num];
        break;
      }
    }
    const intervalStr = fmtInterval(r.interval, false, r.position);
    const gapStr      = fmtInterval(r.gap, true, r.position);

    html += `<tr>
      <td>${r.position}</td>
      <td><span class="team-dot" style="background:#${r.color}"></span>${r.driver}</td>
      <td>${intervalStr}</td>
      <td>${gapStr}</td>
      <td>${fmtLap(r.lastLap)}</td>
      <td>${fmtLap(best)}</td>
      <td><span class="tyre-badge" style="background:${tyreCol}">${r.compound.charAt(0) || '?'}</span></td>
      <td>${r.lapCount}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

// ── Live: Race Control Feed ─────────────────────────────────
function renderRaceControlFeed(messages) {
  const el = document.getElementById('raceControlFeed');
  if (!el) return;
  el.innerHTML = '';
  const recent = (messages || []).slice(-20).reverse();
  recent.forEach(m => {
    const msg   = m.message || m.Message || '';
    const cat   = (m.category || m.Category || '').toUpperCase();
    const flag  = (m.flag || m.Flag || '').toUpperCase();
    let flagCls = '';
    if (flag.includes('GREEN') || cat.includes('GREEN'))        flagCls = 'flag-green';
    else if (flag.includes('YELLOW') || cat.includes('YELLOW')) flagCls = 'flag-yellow';
    else if (flag.includes('RED') || cat.includes('RED'))       flagCls = 'flag-red';
    else if (flag.includes('SAFETY') || cat.includes('SAFETY') || msg.toUpperCase().includes('SAFETY CAR')) flagCls = 'flag-sc';

    const div = document.createElement('div');
    div.className = `rc-message ${flagCls}`;
    const time = m.date || m.Date || m.time || '';
    const tStr = time ? new Date(time).toLocaleTimeString('en-GB', { hour12:false }) : '';
    div.innerHTML = `<span class="rc-time">${tStr}</span><span class="rc-text">${msg}</span>`;
    el.appendChild(div);
  });
}

// ── Live: Weather Widget ────────────────────────────────────
function renderLiveWeather(weather) {
  const el = document.getElementById('liveWeatherWidget');
  if (!el || !weather || !weather.length) return;
  const w = weather[weather.length - 1];
  el.innerHTML = `
    <div class="weather-grid">
      <div class="weather-item">
        <div class="weather-label">Air Temp</div>
        <div class="weather-value">${w.air_temperature ?? w.air_temp ?? '-'}°C</div>
      </div>
      <div class="weather-item">
        <div class="weather-label">Track Temp</div>
        <div class="weather-value">${w.track_temperature ?? w.track_temp ?? '-'}°C</div>
      </div>
      <div class="weather-item">
        <div class="weather-label">Humidity</div>
        <div class="weather-value">${w.humidity ?? '-'}%</div>
      </div>
      <div class="weather-item">
        <div class="weather-label">Wind Speed</div>
        <div class="weather-value">${w.wind_speed ?? '-'} m/s</div>
      </div>
    </div>`;
}

// ── Live: Pit Activity Feed ─────────────────────────────────
function renderPitActivity(pits) {
  const el = document.getElementById('pitActivityFeed');
  if (!el) return;
  el.innerHTML = '';
  const recent = (pits || []).slice(-15).reverse();
  recent.forEach(p => {
    const num    = p.driver_number || p.DriverNumber || '';
    const info   = liveDriverMap[num] || { name: num, color: '888' };
    const compound = (p.compound || p.Compound || '').toUpperCase();
    const dur    = p.pit_duration || p.duration || '-';
    const lap    = p.lap_number || p.Lap || '-';

    const div = document.createElement('div');
    div.className = 'pit-entry';
    div.innerHTML = `
      <span class="pit-driver"><span class="team-dot" style="background:#${info.color}"></span>${info.name}</span>
      <span class="pit-detail">Lap ${lap} · <span class="tyre-badge" style="background:${TYRE_COLORS[compound] || TYRE_COLORS.UNKNOWN}">${compound.charAt(0) || '?'}</span></span>
      <span class="pit-duration">${dur}s</span>`;
    el.appendChild(div);
  });
}

// ── Live: Team Radio Feed ───────────────────────────────────
let currentGlobalAudio = null;
let activePlayButton = null;

function toggleAudio(btn, url) {
  if (currentGlobalAudio && activePlayButton === btn) {
    currentGlobalAudio.pause();
    resetAudioButton(btn);
    currentGlobalAudio = null;
    activePlayButton = null;
    return;
  }
  
  if (currentGlobalAudio) {
    currentGlobalAudio.pause();
    if (activePlayButton) {
      resetAudioButton(activePlayButton);
    }
  }
  
  const audio = new Audio(url);
  currentGlobalAudio = audio;
  activePlayButton = btn;
  
  btn.classList.add('playing');
  btn.querySelector('.play-icon').style.display = 'none';
  btn.querySelector('.pause-icon').style.display = 'inline-block';
  btn.querySelector('.audio-text').textContent = 'Playing...';
  btn.querySelector('.waveform-dot').classList.add('pulse');
  
  audio.play().catch(err => {
    console.error('Audio playback failed:', err);
    resetAudioButton(btn);
    currentGlobalAudio = null;
    activePlayButton = null;
  });
  
  audio.onended = () => {
    resetAudioButton(btn);
    if (currentGlobalAudio === audio) {
      currentGlobalAudio = null;
      activePlayButton = null;
    }
  };
}

function resetAudioButton(btn) {
  btn.classList.remove('playing');
  btn.querySelector('.play-icon').style.display = 'inline-block';
  btn.querySelector('.pause-icon').style.display = 'none';
  btn.querySelector('.audio-text').textContent = 'Listen Radio';
  btn.querySelector('.waveform-dot').classList.remove('pulse');
}

function renderTeamRadio(radios) {
  const el = document.getElementById('teamRadioFeed');
  if (!el) return;
  el.innerHTML = '';
  const recent = (radios || []).slice(-10).reverse();
  recent.forEach(r => {
    const num  = r.driver_number || r.DriverNumber || '';
    const info = liveDriverMap[num] || { name: num, color: '888' };
    const lap  = r.lap_number || r.Lap || '-';
    const url  = r.recording_url || r.RecordingUrl || '';

    const div  = document.createElement('div');
    div.className = 'radio-entry';
    div.innerHTML = `
      <div class="radio-header">
        <span class="radio-driver"><span class="team-dot" style="background:#${info.color}"></span>${info.name}</span>
        <span class="radio-lap">Lap ${lap}</span>
      </div>
      <div class="radio-audio">
        ${url ? `
          <button class="radio-play-btn" onclick="toggleAudio(this, '${url}')">
            <span class="waveform-dot"></span>
            <span class="play-icon">▶</span>
            <span class="pause-icon" style="display:none;">⏸</span>
            <span class="audio-text">Listen Radio</span>
          </button>
        ` : '<span class="no-audio">No recording</span>'}
      </div>`;
    el.appendChild(div);
  });
}

// ═══════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════
window.onload = async () => {
  await loadRaceList();
  autoLoadView('race');
};
