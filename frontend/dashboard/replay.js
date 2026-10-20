/* ═══════════════════════════════════════════════════════════════
   RacePulse — Race Replay Engine  ·  replay.js
   Canvas-based race replay with driver positions, leaderboard,
   Safety Car, playback controls, and keyboard shortcuts.
   ═══════════════════════════════════════════════════════════════ */

const ReplayEngine = (() => {
  // ── State ──────────────────────────────────────────────────
  let canvas, ctx;
  let replayData = null;        // Full payload from API
  let frames = [];
  let trackPoints = [];          // {x, y}[]
  let drsZones = [];
  let drivers = [];              // Driver metadata
  let totalLaps = 0;

  let currentFrame = 0;
  let isPlaying = false;
  let playbackSpeed = 1;
  let lastTimestamp = 0;
  let accumulator = 0;
  let animationId = null;

  // Display toggles
  let showDRS = true;
  let showProgressBar = true;
  let showDriverNames = true;
  let showLegend = false;

  // Selection
  let selectedDrivers = new Set();

  // Transform
  let transform = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };

  // Track bounds
  let trackBounds = { minX: 0, maxX: 1, minY: 0, maxY: 1 };

  // Frame timing
  const BASE_FRAME_INTERVAL = 500; // ms per frame at 1x speed

  // Speeds available
  const SPEEDS = [0.5, 1, 2, 4];

  // ── Public API ─────────────────────────────────────────────
  function init(canvasId) {
    canvas = document.getElementById(canvasId);
    if (!canvas) return;
    ctx = canvas.getContext('2d');

    _resizeCanvas();
    window.addEventListener('resize', _resizeCanvas);
    _bindKeyboard();
    _bindCanvasClick();

    // Leaderboard click handlers
    const lb = document.getElementById('replayLeaderboard');
    if (lb) lb.addEventListener('click', _onLeaderboardClick);
  }

  async function loadReplayData(year, race, sessionType) {
    _showReplayLoading('Computing replay data — this may take a minute on first load…');
    
    try {
      const url = `${API}/api/replay/data?year=${year}&race=${race}&session_type=${sessionType || 'R'}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      replayData = await res.json();

      frames = replayData.frames || [];
      drivers = replayData.drivers || [];
      totalLaps = replayData.total_laps || 0;
      
      // Parse track
      const track = replayData.track || {};
      trackPoints = [];
      if (track.x && track.y) {
        for (let i = 0; i < track.x.length; i++) {
          trackPoints.push({ x: track.x[i], y: track.y[i] });
        }
      }
      drsZones = track.drs_zones || [];

      if (!frames.length) {
        _showReplayLoading('No replay data available for this session.');
        return;
      }

      _computeTrackBounds();
      _resizeCanvas();
      currentFrame = 0;
      isPlaying = false;
      playbackSpeed = 1;
      selectedDrivers.clear();

      _hideReplayLoading();
      _render();
      _updateControls();
      _updateLeaderboard();
    } catch (e) {
      console.error('Failed to load replay data:', e);
      _showReplayLoading('Failed to load replay data. Check console for details.');
    }
  }

  function play() {
    if (!frames.length) return;
    isPlaying = true;
    lastTimestamp = performance.now();
    accumulator = 0;
    _updateControls();
    if (!animationId) _loop(performance.now());
  }

  function pause() {
    isPlaying = false;
    _updateControls();
  }

  function togglePlayPause() {
    if (isPlaying) pause(); else play();
  }

  function rewind(seconds = 5) {
    if (!frames.length) return;
    const framesToSkip = Math.round((seconds * 1000) / BASE_FRAME_INTERVAL);
    currentFrame = Math.max(0, currentFrame - framesToSkip);
    _render();
    _updateLeaderboard();
    _updateControls();
  }

  function fastForward(seconds = 5) {
    if (!frames.length) return;
    const framesToSkip = Math.round((seconds * 1000) / BASE_FRAME_INTERVAL);
    currentFrame = Math.min(frames.length - 1, currentFrame + framesToSkip);
    _render();
    _updateLeaderboard();
    _updateControls();
  }

  function setSpeed(speed) {
    playbackSpeed = speed;
    _updateControls();
  }

  function cycleSpeed() {
    const idx = SPEEDS.indexOf(playbackSpeed);
    playbackSpeed = SPEEDS[(idx + 1) % SPEEDS.length];
    _updateControls();
  }

  function restart() {
    currentFrame = 0;
    isPlaying = false;
    _render();
    _updateLeaderboard();
    _updateControls();
  }

  function seekTo(fraction) {
    if (!frames.length) return;
    currentFrame = Math.round(fraction * (frames.length - 1));
    _render();
    _updateLeaderboard();
    _updateControls();
  }

  function toggleDRS() { showDRS = !showDRS; _render(); }
  function toggleProgressBarDisplay() { showProgressBar = !showProgressBar; _render(); }
  function toggleDriverNames() { showDriverNames = !showDriverNames; _render(); }
  function toggleLegend() { showLegend = !showLegend; _render(); }

  // ── Animation Loop ─────────────────────────────────────────
  function _loop(timestamp) {
    if (!isPlaying) {
      animationId = null;
      return;
    }

    const delta = timestamp - lastTimestamp;
    lastTimestamp = timestamp;
    accumulator += delta * playbackSpeed;

    const interval = BASE_FRAME_INTERVAL;
    while (accumulator >= interval) {
      accumulator -= interval;
      currentFrame++;
      if (currentFrame >= frames.length) {
        currentFrame = frames.length - 1;
        isPlaying = false;
        _updateControls();
        break;
      }
    }

    _render();
    _updateLeaderboard();
    _updateControls();

    if (isPlaying) {
      animationId = requestAnimationFrame(_loop);
    } else {
      animationId = null;
    }
  }

  // ── Canvas Resize ──────────────────────────────────────────
  function _resizeCanvas() {
    if (!canvas) return;
    const container = canvas.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    // Account for leaderboard sidebar (320px)
    const sidebarWidth = 320;
    const w = Math.max(400, rect.width - sidebarWidth - 20);
    const h = Math.max(300, rect.height - 80);
    canvas.width = w * window.devicePixelRatio;
    canvas.height = h * window.devicePixelRatio;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);

    _computeTransform();
    if (frames.length) _render();
  }

  // ── Track Bounds & Transform ───────────────────────────────
  function _computeTrackBounds() {
    if (!trackPoints.length) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    trackPoints.forEach(p => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });
    trackBounds = { minX, maxX, minY, maxY };
    _computeTransform();
  }

  function _computeTransform() {
    if (!canvas) return;
    const w = canvas.width / window.devicePixelRatio;
    const h = canvas.height / window.devicePixelRatio;
    const margin = 40;

    const rangeX = (trackBounds.maxX - trackBounds.minX) || 1;
    const rangeY = (trackBounds.maxY - trackBounds.minY) || 1;

    const scaleX = (w - margin * 2) / rangeX;
    const scaleY = (h - margin * 2) / rangeY;
    const scale = Math.min(scaleX, scaleY);

    const centerX = (trackBounds.minX + trackBounds.maxX) / 2;
    const centerY = (trackBounds.minY + trackBounds.maxY) / 2;

    transform = {
      scaleX: scale,
      scaleY: -scale, // Flip Y axis
      offsetX: w / 2 - centerX * scale,
      offsetY: h / 2 + centerY * scale,
    };
  }

  function _worldToCanvas(wx, wy) {
    return {
      x: wx * transform.scaleX + transform.offsetX,
      y: wy * transform.scaleY + transform.offsetY,
    };
  }

  // ── Rendering ──────────────────────────────────────────────
  function _render() {
    if (!ctx || !canvas) return;
    const w = canvas.width / window.devicePixelRatio;
    const h = canvas.height / window.devicePixelRatio;

    // Clear
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#08080c';
    ctx.fillRect(0, 0, w, h);

    if (!frames.length || !trackPoints.length) return;

    const frame = frames[currentFrame] || frames[0];

    _drawTrack(w, h);
    if (showDRS) _drawDRSZones();
    _drawDrivers(frame);
    _drawSafetyCar(frame);
    _drawLapDisplay(frame, w);
    if (showProgressBar) _drawProgressBar(w, h);
    if (showLegend) _drawLegend(w);
    _drawSelectedDriverTelemetry(frame, w, h);
  }

  function _drawTrack(w, h) {
    if (trackPoints.length < 2) return;

    // Track surface (wide gray line)
    ctx.beginPath();
    const first = _worldToCanvas(trackPoints[0].x, trackPoints[0].y);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < trackPoints.length; i++) {
      const p = _worldToCanvas(trackPoints[i].x, trackPoints[i].y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Track center line
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < trackPoints.length; i++) {
      const p = _worldToCanvas(trackPoints[i].x, trackPoints[i].y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Start/finish line marker
    const sf = _worldToCanvas(trackPoints[0].x, trackPoints[0].y);
    ctx.beginPath();
    ctx.arc(sf.x, sf.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#e10600';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function _drawDRSZones() {
    // DRS zones would be drawn here if data is available
    // For now, we skip since FastF1 doesn't always expose them
  }

  function _drawDrivers(frame) {
    if (!frame || !frame.drivers) return;

    // Draw non-selected drivers first, then selected on top
    const sorted = [...frame.drivers].sort((a, b) => {
      const aSelected = selectedDrivers.has(a.code);
      const bSelected = selectedDrivers.has(b.code);
      if (aSelected && !bSelected) return 1;
      if (!aSelected && bSelected) return -1;
      return 0;
    });

    sorted.forEach(d => {
      const pos = _worldToCanvas(d.x, d.y);
      const isSelected = selectedDrivers.has(d.code);
      const isOut = d.status === 'out';
      const radius = isSelected ? 7 : 5;

      // Glow for selected
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius + 4, 0, Math.PI * 2);
        ctx.fillStyle = d.color.replace('#', 'rgba(') ? 
          _hexToRGBA(d.color, 0.25) : 'rgba(255,255,255,0.15)';
        ctx.fill();
      }

      // Driver dot
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = isOut ? 'rgba(100,100,100,0.5)' : (d.color || '#ffffff');
      ctx.fill();

      // Outline ring
      if (isSelected) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        ctx.strokeStyle = isOut ? 'rgba(100,100,100,0.3)' : 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // OUT marker
      if (isOut) {
        ctx.font = 'bold 8px Inter';
        ctx.fillStyle = '#e10600';
        ctx.textAlign = 'center';
        ctx.fillText('✕', pos.x, pos.y + 3);
      }

      // Driver name label
      if (showDriverNames || isSelected) {
        ctx.font = `${isSelected ? 'bold ' : ''}9px JetBrains Mono, monospace`;
        ctx.fillStyle = isOut ? 'rgba(150,150,150,0.6)' : (isSelected ? '#ffffff' : 'rgba(220,220,240,0.7)');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(d.code, pos.x, pos.y - radius - 4);
      }
    });
  }

  function _drawSafetyCar(frame) {
    const sc = frame.safety_car;
    if (!sc) return;

    const pos = _worldToCanvas(sc.x, sc.y);
    const alpha = sc.alpha || 1;
    const phase = sc.phase || 'on_track';

    // Pulsing glow effect
    const glowRadius = 12 + (phase === 'deploying' ? Math.sin(Date.now() / 200) * 4 : 0);
    const gradient = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, glowRadius);
    gradient.addColorStop(0, `rgba(255, 165, 0, ${0.4 * alpha})`);
    gradient.addColorStop(1, `rgba(255, 165, 0, 0)`);
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, glowRadius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();

    // SC circle
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 165, 0, ${alpha})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(255, 200, 0, ${alpha})`;
    ctx.lineWidth = 2;
    ctx.stroke();

    // SC label
    let label = 'SC';
    if (phase === 'deploying') label = 'SC DEPLOYING';
    else if (phase === 'returning') label = 'SC IN';
    
    ctx.font = 'bold 10px Orbitron, sans-serif';
    ctx.fillStyle = `rgba(255, 200, 0, ${alpha})`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, pos.x, pos.y - 14);
  }

  function _drawLapDisplay(frame, w) {
    const lap = frame.lap || 0;
    const timeSeconds = frame.time || 0;
    const timeStr = _formatTime(timeSeconds);

    // Background
    ctx.fillStyle = 'rgba(8, 8, 12, 0.85)';
    _roundRect(ctx, 12, 12, 180, 62, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(225, 6, 0, 0.3)';
    ctx.lineWidth = 1;
    _roundRect(ctx, 12, 12, 180, 62, 4);
    ctx.stroke();

    // Red accent line
    ctx.fillStyle = '#e10600';
    ctx.fillRect(12, 12, 3, 62);

    // Lap text
    ctx.font = 'bold 11px Orbitron, sans-serif';
    ctx.fillStyle = '#888';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('LAP', 24, 20);

    ctx.font = 'bold 20px JetBrains Mono, monospace';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${lap} / ${totalLaps}`, 58, 16);

    // Time
    ctx.font = '9px Orbitron, sans-serif';
    ctx.fillStyle = '#666';
    ctx.fillText('RACE TIME', 24, 46);

    ctx.font = '13px JetBrains Mono, monospace';
    ctx.fillStyle = '#aaa';
    ctx.fillText(timeStr, 98, 44);
  }

  function _drawProgressBar(w, h) {
    if (!frames.length) return;
    const barY = h - 28;
    const barX = 12;
    const barW = w - 24;
    const barH = 6;
    const progress = currentFrame / (frames.length - 1);

    // Background
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    _roundRect(ctx, barX, barY, barW, barH, 3);
    ctx.fill();

    // Progress fill
    const fillW = progress * barW;
    if (fillW > 0) {
      const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
      grad.addColorStop(0, '#e10600');
      grad.addColorStop(1, '#ff4444');
      ctx.fillStyle = grad;
      _roundRect(ctx, barX, barY, fillW, barH, 3);
      ctx.fill();
    }

    // Scrub handle
    ctx.beginPath();
    ctx.arc(barX + fillW, barY + barH / 2, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // Frame counter
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.fillStyle = '#666';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(`${currentFrame + 1} / ${frames.length}`, w - 14, barY - 14);
  }

  function _drawLegend(w) {
    const x = w - 210;
    const y = 12;
    const lineH = 18;
    const entries = [
      ['SPACE', 'Play / Pause'],
      ['← →', 'Rewind / Forward'],
      ['↑ ↓', 'Speed Up / Down'],
      ['1-4', 'Set Speed'],
      ['R', 'Restart'],
      ['D', 'Toggle DRS'],
      ['B', 'Toggle Progress Bar'],
      ['L', 'Toggle Names'],
      ['H', 'Toggle Legend'],
    ];

    const panelH = entries.length * lineH + 32;
    ctx.fillStyle = 'rgba(8, 8, 12, 0.9)';
    _roundRect(ctx, x, y, 198, panelH, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    _roundRect(ctx, x, y, 198, panelH, 4);
    ctx.stroke();

    ctx.font = 'bold 9px Orbitron, sans-serif';
    ctx.fillStyle = '#e10600';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('CONTROLS', x + 12, y + 10);

    entries.forEach((entry, i) => {
      const ey = y + 28 + i * lineH;
      ctx.font = 'bold 9px JetBrains Mono, monospace';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(entry[0], x + 12, ey);
      ctx.font = '9px Inter, sans-serif';
      ctx.fillStyle = '#888';
      ctx.fillText(entry[1], x + 60, ey);
    });
  }

  function _drawSelectedDriverTelemetry(frame, w, h) {
    if (!selectedDrivers.size || !frame) return;

    let panelY = 82;
    selectedDrivers.forEach(code => {
      const d = frame.drivers.find(dr => dr.code === code);
      if (!d) return;

      const px = 12;
      const pw = 180;
      const ph = 100;

      ctx.fillStyle = 'rgba(8, 8, 12, 0.9)';
      _roundRect(ctx, px, panelY, pw, ph, 4);
      ctx.fill();
      ctx.strokeStyle = d.color || 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 1;
      _roundRect(ctx, px, panelY, pw, ph, 4);
      ctx.stroke();

      // Color accent
      ctx.fillStyle = d.color || '#e10600';
      ctx.fillRect(px, panelY, 3, ph);

      // Driver code
      ctx.font = 'bold 13px Orbitron, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(d.code, px + 12, panelY + 8);

      // Team
      ctx.font = '8px Inter, sans-serif';
      ctx.fillStyle = '#888';
      ctx.fillText(d.team || '', px + 60, panelY + 10);

      // Stats
      const stats = [
        ['SPD', `${d.speed || 0} km/h`],
        ['GEAR', `${d.gear || 0}`],
        ['DRS', d.drs > 0 ? 'OPEN' : 'CLOSED'],
        ['TYRE', d.compound || '?'],
        ['LAP', `${d.lap || 0}`],
      ];

      stats.forEach((s, i) => {
        const sy = panelY + 30 + i * 14;
        ctx.font = '8px Orbitron, sans-serif';
        ctx.fillStyle = '#666';
        ctx.fillText(s[0], px + 12, sy);
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.fillStyle = s[0] === 'DRS' && d.drs > 0 ? '#22c55e' : '#ccc';
        ctx.fillText(s[1], px + 55, sy);
      });

      panelY += ph + 8;
    });
  }

  // ── Leaderboard ────────────────────────────────────────────
  function _updateLeaderboard() {
    const el = document.getElementById('replayLeaderboard');
    if (!el || !frames.length) return;

    const frame = frames[currentFrame];
    if (!frame) return;

    const driverList = [...frame.drivers].sort((a, b) => {
      if (a.status === 'out' && b.status !== 'out') return 1;
      if (a.status !== 'out' && b.status === 'out') return -1;
      return (a.position || 99) - (b.position || 99);
    });

    let html = '';
    driverList.forEach((d, idx) => {
      const isSelected = selectedDrivers.has(d.code);
      const isOut = d.status === 'out';
      const pos = isOut ? '' : (idx + 1);
      const compound = (d.compound || '').toUpperCase();
      const tyreColor = _getTyreColor(compound);
      
      html += `<div class="lb-row ${isSelected ? 'selected' : ''} ${isOut ? 'out' : ''}" data-driver="${d.code}">
        <span class="lb-pos">${pos}</span>
        <span class="lb-color" style="background:${d.color}"></span>
        <span class="lb-name">${d.code}</span>
        <span class="lb-gap">${d.lap ? 'L' + d.lap : ''}</span>
        <span class="lb-tyre" style="background:${tyreColor}">${compound.charAt(0) || '?'}</span>
        ${isOut ? '<span class="lb-status-out">OUT</span>' : ''}
      </div>`;
    });

    el.innerHTML = html;
  }

  function _onLeaderboardClick(e) {
    const row = e.target.closest('.lb-row');
    if (!row) return;
    const code = row.dataset.driver;
    if (!code) return;

    if (e.shiftKey) {
      // Multi-select
      if (selectedDrivers.has(code)) selectedDrivers.delete(code);
      else selectedDrivers.add(code);
    } else {
      // Single select toggle
      if (selectedDrivers.has(code) && selectedDrivers.size === 1) {
        selectedDrivers.clear();
      } else {
        selectedDrivers.clear();
        selectedDrivers.add(code);
      }
    }

    _render();
    _updateLeaderboard();
  }

  // ── Controls ───────────────────────────────────────────────
  function _updateControls() {
    const playBtn = document.getElementById('replayPlayBtn');
    if (playBtn) {
      playBtn.innerHTML = isPlaying ? 
        '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="2" width="4" height="12"/><rect x="9" y="2" width="4" height="12"/></svg>' :
        '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><polygon points="3,1 14,8 3,15"/></svg>';
      playBtn.title = isPlaying ? 'Pause' : 'Play';
    }

    const speedEl = document.getElementById('replaySpeedLabel');
    if (speedEl) speedEl.textContent = playbackSpeed + 'x';

    const progressInput = document.getElementById('replayProgressInput');
    if (progressInput && frames.length) {
      progressInput.value = currentFrame;
      progressInput.max = frames.length - 1;
    }
  }

  // ── Keyboard ───────────────────────────────────────────────
  function _bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      // Only handle if replay view is active
      const replayView = document.getElementById('view-replay');
      if (!replayView || !replayView.classList.contains('active')) return;
      
      // Don't intercept input fields
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          togglePlayPause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          rewind(5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          fastForward(5);
          break;
        case 'ArrowUp':
          e.preventDefault();
          { const idx = SPEEDS.indexOf(playbackSpeed);
            if (idx < SPEEDS.length - 1) setSpeed(SPEEDS[idx + 1]); }
          break;
        case 'ArrowDown':
          e.preventDefault();
          { const idx = SPEEDS.indexOf(playbackSpeed);
            if (idx > 0) setSpeed(SPEEDS[idx - 1]); }
          break;
        case 'Digit1': setSpeed(0.5); break;
        case 'Digit2': setSpeed(1); break;
        case 'Digit3': setSpeed(2); break;
        case 'Digit4': setSpeed(4); break;
        case 'KeyR': restart(); break;
        case 'KeyD': toggleDRS(); break;
        case 'KeyB': toggleProgressBarDisplay(); break;
        case 'KeyL': toggleDriverNames(); break;
        case 'KeyH': toggleLegend(); break;
      }
    });
  }

  function _bindCanvasClick() {
    if (!canvas) return;
    
    // Progress bar scrubbing
    let isScrubbing = false;
    
    canvas.addEventListener('mousedown', (e) => {
      if (!showProgressBar || !frames.length) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const h = canvas.height / window.devicePixelRatio;
      const barY = h - 28;
      
      if (my >= barY - 8 && my <= barY + 14) {
        isScrubbing = true;
        _scrubTo(mx);
      }
    });
    
    canvas.addEventListener('mousemove', (e) => {
      if (!isScrubbing) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      _scrubTo(mx);
    });
    
    window.addEventListener('mouseup', () => {
      isScrubbing = false;
    });

    // Click on driver dot
    canvas.addEventListener('click', (e) => {
      if (isScrubbing) return;
      if (!frames.length) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      
      const frame = frames[currentFrame];
      if (!frame) return;
      
      let hitDriver = null;
      let minDist = 15; // click tolerance
      
      frame.drivers.forEach(d => {
        const pos = _worldToCanvas(d.x, d.y);
        const dist = Math.sqrt((pos.x - mx) ** 2 + (pos.y - my) ** 2);
        if (dist < minDist) {
          minDist = dist;
          hitDriver = d.code;
        }
      });
      
      if (hitDriver) {
        if (e.shiftKey) {
          if (selectedDrivers.has(hitDriver)) selectedDrivers.delete(hitDriver);
          else selectedDrivers.add(hitDriver);
        } else {
          if (selectedDrivers.has(hitDriver) && selectedDrivers.size === 1) {
            selectedDrivers.clear();
          } else {
            selectedDrivers.clear();
            selectedDrivers.add(hitDriver);
          }
        }
        _render();
        _updateLeaderboard();
      }
    });
  }

  function _scrubTo(mx) {
    const w = canvas.width / window.devicePixelRatio;
    const barX = 12;
    const barW = w - 24;
    const frac = Math.max(0, Math.min(1, (mx - barX) / barW));
    seekTo(frac);
  }

  // ── Helpers ────────────────────────────────────────────────
  function _formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function _hexToRGBA(hex, alpha) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function _getTyreColor(compound) {
    const colors = {
      'SOFT': '#ff3333', 'MEDIUM': '#ffdd00', 'HARD': '#cccccc',
      'INTERMEDIATE': '#43b02a', 'WET': '#0072c6', 'UNKNOWN': '#888'
    };
    return colors[compound] || colors.UNKNOWN;
  }

  function _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function _showReplayLoading(msg) {
    const el = document.getElementById('replayLoadingOverlay');
    if (el) {
      el.classList.remove('hidden');
      const txt = el.querySelector('.replay-loading-text');
      if (txt) txt.textContent = msg || 'Loading…';
    }
  }

  function _hideReplayLoading() {
    const el = document.getElementById('replayLoadingOverlay');
    if (el) el.classList.add('hidden');
  }

  // ── Expose ─────────────────────────────────────────────────
  return {
    init,
    loadReplayData,
    play,
    pause,
    togglePlayPause,
    rewind,
    fastForward,
    setSpeed,
    cycleSpeed,
    restart,
    seekTo,
    toggleDRS,
    toggleProgressBarDisplay,
    toggleDriverNames,
    toggleLegend,
  };
})();
