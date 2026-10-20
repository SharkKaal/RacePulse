from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import numpy as np
import pandas as pd

import asyncio
import json

from src.data_ingestion.fastf1_loader import (
    load_session,
    get_session_info,
    get_all_laps,
    get_race_results,
    get_dnfs,
    get_qualifying_results,
    get_session_weather,
    get_tyre_stints,
    get_event_schedule,
    get_drivers_for_session,
    get_speed_trap_data,
    get_grid_vs_finish,
    get_pit_stop_data,
    get_tyre_degradation,
    get_fastest_laps_board,
    get_clean_race_pace,
    get_track_evolution,
)
from src.data_ingestion.ergast_loader import get_historical_driver_standings, get_pit_stops_vs_position
from src.data_ingestion.replay_data import compute_replay_data, get_replay_track
import httpx
import time
from functools import lru_cache

app = FastAPI()

# ================= CORS =================
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ================= SERVE FRONTEND =================
@app.get("/")
def home():
    return FileResponse("frontend/dashboard/index.html")

# Serve static assets (CSS, JS)
app.mount("/static", StaticFiles(directory="frontend/dashboard"), name="static")


def _extract_lap(session, driver: str, lap_spec: str = "fastest"):
    """
    Safely resolves a lap object for a given driver and lap specifier.
    Handles driver code casing, missing laps, and fastest lap fallbacks.
    """
    if session is None or not hasattr(session, "laps") or session.laps is None:
        return None
    if getattr(session.laps, "empty", False) is True:
        return None

    driver_clean = driver.strip()
    driver_code = driver_clean.upper()
    
    driver_laps = None
    # Try picking driver laps
    try:
        driver_laps = session.laps.pick_drivers(driver_code)
    except Exception:
        driver_laps = None

    if driver_laps is None or getattr(driver_laps, "empty", False) is True:
        try:
            driver_laps = session.laps.pick_drivers(driver_clean)
        except Exception:
            driver_laps = None

    # Fallback to column matching
    if (driver_laps is None or getattr(driver_laps, "empty", False) is True) and hasattr(session.laps, "columns") and "Driver" in session.laps.columns:
        try:
            driver_laps = session.laps[session.laps["Driver"].astype(str).str.upper() == driver_code]
        except Exception:
            pass
    if (driver_laps is None or getattr(driver_laps, "empty", False) is True) and hasattr(session.laps, "columns") and "DriverNumber" in session.laps.columns:
        try:
            driver_laps = session.laps[session.laps["DriverNumber"].astype(str) == driver_clean]
        except Exception:
            pass

    if driver_laps is None or getattr(driver_laps, "empty", False) is True:
        return None

    lap_obj = None
    if str(lap_spec).strip().lower() == "fastest":
        try:
            lap_obj = driver_laps.pick_fastest()
        except Exception:
            lap_obj = None

        # If pick_fastest returned None (e.g. only_accurate=True found no accurate laps), fallback to best LapTime
        if lap_obj is None or getattr(lap_obj, "empty", False) is True:
            if hasattr(driver_laps, "dropna"):
                try:
                    valid_laps = driver_laps.dropna(subset=["LapTime"])
                    if not getattr(valid_laps, "empty", False):
                        lap_obj = valid_laps.sort_values(by="LapTime").iloc[0]
                    elif hasattr(driver_laps, "iloc") and len(driver_laps) > 0:
                        lap_obj = driver_laps.iloc[-1]
                except Exception:
                    pass
    else:
        try:
            lap_num = int(lap_spec)
            matched = driver_laps[driver_laps["LapNumber"] == lap_num]
            if not getattr(matched, "empty", False):
                lap_obj = matched.iloc[0]
        except (ValueError, TypeError, IndexError, KeyError):
            pass

        # Fallback to fastest or available lap if specific lap number not found
        if lap_obj is None:
            try:
                lap_obj = driver_laps.pick_fastest()
            except Exception:
                lap_obj = None
            if (lap_obj is None or getattr(lap_obj, "empty", False) is True) and hasattr(driver_laps, "dropna"):
                try:
                    valid_laps = driver_laps.dropna(subset=["LapTime"])
                    if not getattr(valid_laps, "empty", False):
                        lap_obj = valid_laps.iloc[0]
                    elif hasattr(driver_laps, "iloc") and len(driver_laps) > 0:
                        lap_obj = driver_laps.iloc[-1]
                except Exception:
                    pass

    if lap_obj is None or getattr(lap_obj, "empty", False) is True:
        return None

    return lap_obj


# ================= TELEMETRY COMPARISON API =================
@app.get("/compare")
def compare(
    year: int = Query(...),
    race: str = Query(...),
    driver1: str = Query(...),
    driver2: str = Query(...),
    lap1: str = Query(default="fastest"),
    lap2: str = Query(default="fastest"),
    session_type: str = Query(default="R")
):
    session = load_session(year, race, session_type=session_type)
    if session is None or not hasattr(session, "laps") or session.laps is None or getattr(session.laps, "empty", False) is True:
        raise HTTPException(
            status_code=404,
            detail=f"No session lap data found for {year} {race} (Session: {session_type})."
        )

    # Get laps safely
    lap1_obj = _extract_lap(session, driver1, lap1)
    lap2_obj = _extract_lap(session, driver2, lap2)

    if lap1_obj is None:
        raise HTTPException(
            status_code=404,
            detail=f"No lap data found for driver '{driver1}' (Lap: {lap1}). Please verify driver identifier or lap number."
        )

    if lap2_obj is None:
        raise HTTPException(
            status_code=404,
            detail=f"No lap data found for driver '{driver2}' (Lap: {lap2}). Please verify driver identifier or lap number."
        )

    # ================= TELEMETRY =================
    try:
        tel1_raw = lap1_obj.get_telemetry()
        if tel1_raw is None or getattr(tel1_raw, "empty", False) is True:
            raise ValueError(f"Telemetry empty for {driver1}")
        tel1 = tel1_raw.add_distance() if hasattr(tel1_raw, "add_distance") else tel1_raw
        if getattr(tel1, "empty", False) is True:
            raise ValueError(f"Telemetry empty for {driver1}")
    except Exception as e:
        raise HTTPException(
            status_code=404,
            detail=f"Telemetry data unavailable for driver '{driver1}' (Lap: {lap1}): {str(e)}"
        )

    try:
        tel2_raw = lap2_obj.get_telemetry()
        if tel2_raw is None or getattr(tel2_raw, "empty", False) is True:
            raise ValueError(f"Telemetry empty for {driver2}")
        tel2 = tel2_raw.add_distance() if hasattr(tel2_raw, "add_distance") else tel2_raw
        if getattr(tel2, "empty", False) is True:
            raise ValueError(f"Telemetry empty for {driver2}")
    except Exception as e:
        raise HTTPException(
            status_code=404,
            detail=f"Telemetry data unavailable for driver '{driver2}' (Lap: {lap2}): {str(e)}"
        )

    # ================= POSITION DATA =================
    try:
        pos1 = lap1_obj.get_pos_data()
        x1 = pos1["X"].to_numpy() if pos1 is not None and getattr(pos1, "empty", False) is not True and hasattr(pos1, "columns") and "X" in pos1.columns else np.array([])
        y1 = pos1["Y"].to_numpy() if pos1 is not None and getattr(pos1, "empty", False) is not True and hasattr(pos1, "columns") and "Y" in pos1.columns else np.array([])
    except Exception:
        x1, y1 = np.array([]), np.array([])

    try:
        pos2 = lap2_obj.get_pos_data()
        x2 = pos2["X"].to_numpy() if pos2 is not None and getattr(pos2, "empty", False) is not True and hasattr(pos2, "columns") and "X" in pos2.columns else np.array([])
        y2 = pos2["Y"].to_numpy() if pos2 is not None and getattr(pos2, "empty", False) is not True and hasattr(pos2, "columns") and "Y" in pos2.columns else np.array([])
    except Exception:
        x2, y2 = np.array([]), np.array([])

    # ================= SPEED =================
    d1, s1 = tel1["Distance"], tel1["Speed"]
    d2, s2 = tel2["Distance"], tel2["Speed"]

    common_distance = np.linspace(
        max(d1.min(), d2.min()),
        min(d1.max(), d2.max()),
        1000
    )

    s1_i = np.asarray(np.interp(common_distance, d1, s1))
    s2_i = np.asarray(np.interp(common_distance, d2, s2))

    # ================= DELTA =================
    s1_ms = s1_i / 3.6
    s2_ms = s2_i / 3.6

    dt1 = np.cumsum(np.diff(common_distance) / s1_ms[:-1])
    dt2 = np.cumsum(np.diff(common_distance) / s2_ms[:-1])

    dt1 = np.insert(dt1, 0, 0)
    dt2 = np.insert(dt2, 0, 0)

    delta = dt1 - dt2

    # ================= INPUTS =================
    throttle1 = np.interp(common_distance, d1, tel1["Throttle"])
    throttle2 = np.interp(common_distance, d2, tel2["Throttle"])

    brake1 = np.interp(common_distance, d1, tel1["Brake"])
    brake2 = np.interp(common_distance, d2, tel2["Brake"])
    
    gear1 = np.interp(common_distance, d1, tel1["nGear"])
    gear2 = np.interp(common_distance, d2, tel2["nGear"])
    
    rpm1 = np.interp(common_distance, d1, tel1["RPM"])
    rpm2 = np.interp(common_distance, d2, tel2["RPM"])

    # ================= DRS =================
    drs1 = np.interp(common_distance, d1, tel1["DRS"].fillna(0))
    drs2 = np.interp(common_distance, d2, tel2["DRS"].fillna(0))

    # ================= HEATMAP =================
    speed_map = s1_i  # used for track coloring

    # ================= SECTORS =================
    split1 = int(len(delta) * 0.33)
    split2 = int(len(delta) * 0.66)

    sectors = [
        float(delta[split1]),
        float(delta[split2] - delta[split1]),
        float(delta[-1] - delta[split2])
    ]

    sector_distances = [
        float(common_distance[split1]),
        float(common_distance[split2])
    ]

    # ================= DRIVER INFO =================
    results = session.results
    dr1_info = results[results["Abbreviation"] == driver1]
    dr2_info = results[results["Abbreviation"] == driver2]
    
    dr1_team = str(dr1_info.iloc[0]["TeamName"]) if not dr1_info.empty else ""
    dr2_team = str(dr2_info.iloc[0]["TeamName"]) if not dr2_info.empty else ""
    dr1_color = f"#{dr1_info.iloc[0]['TeamColor']}" if not dr1_info.empty and pd.notna(dr1_info.iloc[0].get("TeamColor")) else "#00d2be"
    dr2_color = f"#{dr2_info.iloc[0]['TeamColor']}" if not dr2_info.empty and pd.notna(dr2_info.iloc[0].get("TeamColor")) else "#ff8700"

    # ================= RESPONSE =================
    return {
        "distance": common_distance.tolist(),

        "speed1": s1_i.tolist(),
        "speed2": s2_i.tolist(),

        "delta": delta.tolist(),

        "throttle1": throttle1.tolist(),
        "throttle2": throttle2.tolist(),

        "brake1": brake1.tolist(),
        "brake2": brake2.tolist(),
        
        "gear1": gear1.tolist(),
        "gear2": gear2.tolist(),
        
        "rpm1": rpm1.tolist(),
        "rpm2": rpm2.tolist(),

        "drs1": drs1.tolist(),
        "drs2": drs2.tolist(),

        "x1": x1.tolist(),
        "y1": y1.tolist(),
        "x2": x2.tolist(),
        "y2": y2.tolist(),

        "speed_map": speed_map.tolist(),

        "sectors": sectors,
        "sector_distances": sector_distances,

        "driver1": driver1,
        "driver2": driver2,
        "driver1_team": dr1_team,
        "driver2_team": dr2_team,
        "driver1_color": dr1_color,
        "driver2_color": dr2_color,
    }


# ================= SESSION INFO =================
@app.get("/api/session-info")
def api_session_info(
    year: int = Query(...),
    race: str = Query(...),
    session_type: str = Query(default="R")
):
    info, _ = get_session_info(year, race, session_type)
    return info


# ================= LAPS DATA =================
@app.get("/api/laps")
def api_laps(
    year: int = Query(...),
    race: str = Query(...),
    session_type: str = Query(default="R")
):
    session = load_session(year, race, session_type=session_type)
    laps = get_all_laps(session)
    return {"laps": laps}


# ================= RACE RESULTS =================
@app.get("/api/results")
def api_results(
    year: int = Query(...),
    race: str = Query(...),
    session_type: str = Query(default="R")
):
    session = load_session(year, race, session_type=session_type)
    results = get_race_results(session)
    dnfs = get_dnfs(session)
    return {"results": results, "dnfs": dnfs}


# ================= QUALIFYING RESULTS =================
@app.get("/api/qualifying")
def api_qualifying(
    year: int = Query(...),
    race: str = Query(...)
):
    results = get_qualifying_results(year, race)
    return {"results": results}


# ================= WEATHER DATA =================
@app.get("/api/weather")
def api_weather(
    year: int = Query(...),
    race: str = Query(...),
    session_type: str = Query(default="R")
):
    session = load_session(year, race, session_type=session_type)
    weather = get_session_weather(session)
    return {"weather": weather}


# ================= TYRE STRATEGY =================
@app.get("/api/tyre-strategy")
def api_tyre_strategy(
    year: int = Query(...),
    race: str = Query(...),
    session_type: str = Query(default="R")
):
    session = load_session(year, race, session_type=session_type)
    stints = get_tyre_stints(session)
    return {"stints": stints}


# ================= RACE LIST =================
@app.get("/api/race-list")
def api_race_list(
    year: int = Query(...)
):
    events = get_event_schedule(year)
    return {"events": events}


# ================= DRIVER LIST =================
@app.get("/api/driver-list")
def api_driver_list(
    year: int = Query(...),
    race: str = Query(...),
    session_type: str = Query(default="R")
):
    session = load_session(year, race, session_type=session_type)
    drivers = get_drivers_for_session(session)
    return {"drivers": drivers}


# ================= DRIVER STANDINGS =================
@app.get("/api/standings/drivers")
def api_driver_standings(
    year: int = Query(...)
):
    df = get_historical_driver_standings(year, year)
    if df.empty:
        return {"standings": []}
    return {"standings": df.to_dict(orient="records")}


# ================= CONSTRUCTOR STANDINGS =================
@app.get("/api/standings/constructors")
def api_constructor_standings(
    year: int = Query(...)
):
    from fastf1.ergast import Ergast
    ergast = Ergast()
    try:
        standings = ergast.get_constructor_standings(season=year)
        if standings.content:
            df = standings.content[0]
            records = []
            for _, row in df.iterrows():
                records.append({
                    "position": int(row.get("position", 0)) if pd.notna(row.get("position")) else None,
                    "constructorId": str(row.get("constructorId", "")),
                    "constructorName": str(row.get("constructorName", "")) if pd.notna(row.get("constructorName")) else str(row.get("constructorId", "")),
                    "points": float(row.get("points", 0)) if pd.notna(row.get("points")) else 0,
                    "wins": int(row.get("wins", 0)) if pd.notna(row.get("wins")) else 0,
                })
            return {"standings": records}
    except Exception as e:
        print(f"Error fetching constructor standings: {e}")
    return {"standings": []}


# ================= PHASE 1: ENHANCED ANALYTICS =================

@app.get("/api/speed-traps")
def api_speed_traps(
    year: int = Query(...),
    race: str = Query(...),
    session_type: str = Query(default="R")
):
    session = load_session(year, race, session_type=session_type)
    data = get_speed_trap_data(session)
    return {"speed_traps": data}


@app.get("/api/grid-vs-finish")
def api_grid_vs_finish(
    year: int = Query(...),
    race: str = Query(...),
    session_type: str = Query(default="R")
):
    session = load_session(year, race, session_type=session_type)
    data = get_grid_vs_finish(session)
    return {"grid_vs_finish": data}


@app.get("/api/pit-stops")
def api_pit_stops(
    year: int = Query(...),
    race: str = Query(...),
    session_type: str = Query(default="R")
):
    session = load_session(year, race, session_type=session_type)
    data = get_pit_stop_data(session)
    return {"pit_stops": data}


@app.get("/api/tyre-degradation")
def api_tyre_degradation(
    year: int = Query(...),
    race: str = Query(...),
    session_type: str = Query(default="R")
):
    session = load_session(year, race, session_type=session_type)
    data = get_tyre_degradation(session)
    return {"degradation": data}


@app.get("/api/fastest-laps")
def api_fastest_laps(
    year: int = Query(...),
    race: str = Query(...),
    session_type: str = Query(default="R")
):
    session = load_session(year, race, session_type=session_type)
    data = get_fastest_laps_board(session)
    return {"fastest_laps": data}


@app.get("/api/race-pace")
def api_race_pace(
    year: int = Query(...),
    race: str = Query(...),
    session_type: str = Query(default="R")
):
    session = load_session(year, race, session_type=session_type)
    data = get_clean_race_pace(session)
    return {"race_pace": data}


# ================= PHASE 2: CHAMPIONSHIP DEPTH =================

@app.get("/api/points-progression")
def api_points_progression(
    year: int = Query(...)
):
    """Get cumulative points per driver across the season using Ergast."""
    from fastf1.ergast import Ergast
    ergast = Ergast()
    try:
        schedule_result = ergast.get_race_schedule(season=year)
        if schedule_result.empty:
            return {"progression": [], "rounds": 0}
        num_rounds = len(schedule_result)

        # Accumulate points per driver across rounds
        driver_points = {}  # driverId -> [cumulative per round]
        driver_names = {}   # driverId -> display name

        for rnd in range(1, num_rounds + 1):
            try:
                result = ergast.get_race_results(season=year, round=rnd)
                if not result.content:
                    continue
                race_df = result.content[0]
                for _, row in race_df.iterrows():
                    did = str(row.get("driverId", ""))
                    pts = float(row.get("points", 0)) if pd.notna(row.get("points")) else 0
                    if did not in driver_points:
                        driver_points[did] = [0] * num_rounds
                        code = str(row.get("driverCode", did[:3].upper())) if pd.notna(row.get("driverCode")) else did[:3].upper()
                        driver_names[did] = code
                    # Add points for this round
                    driver_points[did][rnd - 1] = pts
            except Exception as e:
                print(f"Points progression: round {rnd} error: {e}")
                continue

        # Convert to cumulative
        progression = []
        for did, points_list in driver_points.items():
            cumulative = []
            total = 0
            for p in points_list:
                total += p
                cumulative.append(total)
            if total > 0:  # Only include drivers who scored
                progression.append({
                    "driver": driver_names.get(did, did),
                    "driverId": did,
                    "points": cumulative,
                    "total": total,
                })

        progression.sort(key=lambda x: x["total"], reverse=True)
        return {"progression": progression[:20], "rounds": num_rounds}  # Top 20
    except Exception as e:
        print(f"Points progression error: {e}")
        return {"progression": [], "rounds": 0}


@app.get("/api/teammate-comparison")
def api_teammate_comparison(
    year: int = Query(...)
):
    """Get head-to-head teammate comparison for qualifying and race."""
    from fastf1.ergast import Ergast
    ergast = Ergast()
    try:
        # Get constructor standings to identify teams and their drivers
        standings = ergast.get_constructor_standings(season=year)
        if not standings.content:
            return {"comparisons": []}

        # Get all race results for the season
        schedule_result = ergast.get_race_schedule(season=year)
        if schedule_result.empty:
            return {"comparisons": []}
        num_rounds = len(schedule_result)

        # Collect all results per driver
        driver_results = {}  # driverId -> {constructorId, races: [{round, grid, position, points}]}

        for rnd in range(1, num_rounds + 1):
            try:
                result = ergast.get_race_results(season=year, round=rnd)
                if not result.content:
                    continue
                race_df = result.content[0]
                for _, row in race_df.iterrows():
                    did = str(row.get("driverId", ""))
                    cid = str(row.get("constructorId", "")) if pd.notna(row.get("constructorId")) else ""
                    if did not in driver_results:
                        code = str(row.get("driverCode", did[:3].upper())) if pd.notna(row.get("driverCode")) else did[:3].upper()
                        driver_results[did] = {"constructorId": cid, "code": code, "races": []}
                    driver_results[did]["races"].append({
                        "round": rnd,
                        "grid": int(row.get("grid", 0)) if pd.notna(row.get("grid")) else None,
                        "position": int(row.get("position", 0)) if pd.notna(row.get("position")) else None,
                        "points": float(row.get("points", 0)) if pd.notna(row.get("points")) else 0,
                    })
            except Exception:
                continue

        # Group drivers by constructor
        constructor_drivers = {}
        for did, info in driver_results.items():
            cid = info["constructorId"]
            if cid not in constructor_drivers:
                constructor_drivers[cid] = []
            constructor_drivers[cid].append(did)

        # Build comparisons for each team pair
        comparisons = []
        for cid, drivers in constructor_drivers.items():
            if len(drivers) < 2:
                continue
            # Take first two drivers (primary pair)
            d1, d2 = drivers[0], drivers[1]
            d1_info, d2_info = driver_results[d1], driver_results[d2]

            # Head-to-head race finishes
            h2h_race = {"d1_wins": 0, "d2_wins": 0}
            h2h_quali = {"d1_wins": 0, "d2_wins": 0}
            d1_total_pts = 0
            d2_total_pts = 0

            d1_races = {r["round"]: r for r in d1_info["races"]}
            d2_races = {r["round"]: r for r in d2_info["races"]}

            for rnd in set(d1_races.keys()) & set(d2_races.keys()):
                r1, r2 = d1_races[rnd], d2_races[rnd]
                # Race H2H
                if r1["position"] and r2["position"]:
                    if r1["position"] < r2["position"]:
                        h2h_race["d1_wins"] += 1
                    elif r2["position"] < r1["position"]:
                        h2h_race["d2_wins"] += 1
                # Quali H2H (grid position)
                if r1["grid"] and r2["grid"]:
                    if r1["grid"] < r2["grid"]:
                        h2h_quali["d1_wins"] += 1
                    elif r2["grid"] < r1["grid"]:
                        h2h_quali["d2_wins"] += 1

                d1_total_pts += r1["points"]
                d2_total_pts += r2["points"]

            comparisons.append({
                "constructor": cid,
                "driver1": d1_info["code"],
                "driver2": d2_info["code"],
                "race_h2h": h2h_race,
                "quali_h2h": h2h_quali,
                "driver1_points": d1_total_pts,
                "driver2_points": d2_total_pts,
            })

        return {"comparisons": comparisons}
    except Exception as e:
        print(f"Teammate comparison error: {e}")
        return {"comparisons": []}


# ================= PHASE 3: TRACK EVOLUTION =================

@app.get("/api/track-evolution")
def api_track_evolution(
    year: int = Query(...),
    race: str = Query(...),
    session_type: str = Query(default="R")
):
    session = load_session(year, race, session_type=session_type)
    data = get_track_evolution(session)
    return {"evolution": data}


# ================= PHASE 4: OPENF1 LIVE DATA PROXY =================

OPENF1_BASE = "https://api.openf1.org/v1"
_openf1_cache = {}  # key -> (timestamp, data)
OPENF1_CACHE_TTL = 10  # seconds for live data
OPENF1_HIST_TTL = 3600  # 1 hour for historical

openf1_semaphore = asyncio.Semaphore(2)


async def fetch_openf1(endpoint: str, params: dict = None, ttl: int = None):
    """Fetch from OpenF1 with caching, serialization, and retry on 429/errors."""
    cache_key = f"{endpoint}:{json.dumps(params or {}, sort_keys=True)}"
    cache_ttl = ttl or OPENF1_CACHE_TTL

    # Check cache
    if cache_key in _openf1_cache:
        ts, data = _openf1_cache[cache_key]
        if time.time() - ts < cache_ttl:
            return data

    url = f"{OPENF1_BASE}/{endpoint}"
    async with openf1_semaphore:
        for attempt in range(3):
            try:
                async with httpx.AsyncClient(timeout=15.0) as client:
                    resp = await client.get(url, params=params)
                    if resp.status_code == 429:
                        # Rate limited! Back off and retry
                        wait_time = (attempt + 1) * 0.6
                        await asyncio.sleep(wait_time)
                        continue
                    resp.raise_for_status()
                    data = resp.json()
                    _openf1_cache[cache_key] = (time.time(), data)
                    return data
            except Exception as e:
                if attempt == 2:
                    print(f"OpenF1 fetch error [{endpoint}] after 3 attempts: {e}")
                else:
                    await asyncio.sleep(0.3)

    # Return cached data if available (even if stale)
    if cache_key in _openf1_cache:
        return _openf1_cache[cache_key][1]
    return []


@app.get("/api/live/session")
async def api_live_session():
    """Get current/latest session info."""
    data = await fetch_openf1("sessions", {"session_key": "latest"})
    return {"session": data[0] if data else None}


@app.get("/api/live/meetings")
async def api_live_meetings(
    year: int = Query(default=2026)
):
    data = await fetch_openf1("meetings", {"year": year}, ttl=OPENF1_HIST_TTL)
    return {"meetings": data}


@app.get("/api/live/positions")
async def api_live_positions(
    session_key: str = Query(default="latest")
):
    data = await fetch_openf1("position", {"session_key": session_key})
    return {"positions": data}


@app.get("/api/live/laps")
async def api_live_laps(
    session_key: str = Query(default="latest")
):
    data = await fetch_openf1("laps", {"session_key": session_key})
    return {"laps": data}


@app.get("/api/live/intervals")
async def api_live_intervals(
    session_key: str = Query(default="latest")
):
    data = await fetch_openf1("intervals", {"session_key": session_key})
    return {"intervals": data}


@app.get("/api/live/race-control")
async def api_live_race_control(
    session_key: str = Query(default="latest")
):
    data = await fetch_openf1("race_control", {"session_key": session_key})
    return {"messages": data}


@app.get("/api/live/weather")
async def api_live_weather(
    session_key: str = Query(default="latest")
):
    data = await fetch_openf1("weather", {"session_key": session_key})
    return {"weather": data}


@app.get("/api/live/pit")
async def api_live_pit(
    session_key: str = Query(default="latest")
):
    data = await fetch_openf1("pit", {"session_key": session_key})
    return {"pits": data}


@app.get("/api/live/stints")
async def api_live_stints(
    session_key: str = Query(default="latest")
):
    data = await fetch_openf1("stints", {"session_key": session_key})
    return {"stints": data}


@app.get("/api/live/team-radio")
async def api_live_team_radio(
    session_key: str = Query(default="latest")
):
    data = await fetch_openf1("team_radio", {"session_key": session_key})
    return {"radio": data}


@app.get("/api/live/drivers")
async def api_live_drivers(
    session_key: str = Query(default="latest")
):
    data = await fetch_openf1("drivers", {"session_key": session_key}, ttl=OPENF1_HIST_TTL)
    return {"drivers": data}


@app.get("/api/live/location")
async def api_live_location(
    session_key: str = Query(default="latest")
):
    data = await fetch_openf1("location", {"session_key": session_key})
    return {"locations": data}



# ================= PHASE 5: RACE REPLAY =================

@app.get("/api/replay/data")
def api_replay_data(
    year: int = Query(...),
    race: str = Query(...),
    session_type: str = Query(default="R"),
    refresh: bool = Query(default=False)
):
    """Returns the full pre-computed replay payload as JSON."""
    data = compute_replay_data(year, race, session_type, force_refresh=refresh)
    return data


@app.get("/api/replay/track")
def api_replay_track(
    year: int = Query(...),
    race: str = Query(...),
    session_type: str = Query(default="R")
):
    """Returns just the track outline, DRS zones, and pit lane coords."""
    data = get_replay_track(year, race, session_type)
    return data


# ================= LEGACY ENDPOINTS =================

@app.get("/history/standings")
def get_standings(
    start_year: int = Query(...),
    end_year: int = Query(...)
):
    df = get_historical_driver_standings(start_year, end_year)
    # Convert dataframe to list of dicts for JSON response
    # NaN values need to be handled, but points/position shouldn't have them
    return df.to_dict(orient="records")

@app.get("/analysis/pitstops")
def get_pitstops(
    year: int = Query(...),
    round_num: int = Query(...)
):
    df = get_pit_stops_vs_position(year, round_num)
    
    # We need to convert Timedelta duration to seconds (float) for JSON serialization
    if not df.empty and 'duration' in df.columns:
        # Some durations might be NaN if missing, or string '24.5' instead of timedelta depending on ergast mirror
        # Let's ensure it's a string representation or float
        df['duration_sec'] = df['duration'].apply(lambda x: x.total_seconds() if pd.notnull(x) and hasattr(x, 'total_seconds') else float(x) if pd.notnull(x) and str(x).replace('.','',1).isdigit() else None)
        
    # Drop rows where we couldn't parse duration or position
    df = df.dropna(subset=['duration_sec', 'position'])
    
    return df.to_dict(orient="records")


# ================= 3D TRACK =================

@app.get("/track/3d")
def get_3d_track(
    year: int = Query(...),
    race: str = Query(...),
    session_type: str = Query(default="R")
):
    """
    Returns X, Y, Z coordinates for the fastest lap of a session,
    to be used for generating 3D track meshes in the frontend.
    """
    session = load_session(year, race, session_type=session_type)
    if session is None or not hasattr(session, "laps") or session.laps is None or getattr(session.laps, "empty", False) is True:
        raise HTTPException(
            status_code=404,
            detail=f"No session lap data found for {year} {race} (Session: {session_type})."
        )
    
    # Get the single fastest lap of the entire session to use as the track reference line
    try:
        fastest_lap = session.laps.pick_fastest()
    except Exception:
        fastest_lap = None

    if fastest_lap is None or getattr(fastest_lap, "empty", False) is True:
        if hasattr(session.laps, "dropna"):
            try:
                valid = session.laps.dropna(subset=["LapTime"])
                fastest_lap = valid.sort_values(by="LapTime").iloc[0] if not getattr(valid, "empty", False) else session.laps.iloc[0]
            except Exception:
                pass

    if fastest_lap is None:
        raise HTTPException(status_code=404, detail="No fastest lap found for this session")

    try:
        pos_data = fastest_lap.get_pos_data()
    except Exception as e:
        raise HTTPException(
            status_code=404,
            detail=f"Failed to retrieve position data for track 3D: {str(e)}"
        )

    if pos_data is None or getattr(pos_data, "empty", False) is True:
        raise HTTPException(status_code=404, detail="No position data available for 3D track")
    
    # Some tracks might not have Z data reliably, but fastf1 usually provides it if available
    x = pos_data["X"].to_numpy().tolist() if hasattr(pos_data, "columns") and "X" in pos_data.columns else []
    y = pos_data["Y"].to_numpy().tolist() if hasattr(pos_data, "columns") and "Y" in pos_data.columns else []
    z = pos_data["Z"].to_numpy().tolist() if hasattr(pos_data, "columns") and "Z" in pos_data.columns else [0] * len(x)
    
    return {
        "x": x,
        "y": y,
        "z": z
    }


@app.get("/api/compare-drivers")
def api_compare_drivers(
    year: int = Query(...),
    driver1: str = Query(...),
    driver2: str = Query(...)
):
    """Compare any two drivers for the given season."""
    from fastf1.ergast import Ergast
    import pandas as pd
    import numpy as np
    ergast = Ergast()
    
    try:
        schedule_result = ergast.get_race_schedule(season=year)
        if schedule_result.empty:
            return {"status": "error", "message": "No schedule found"}
        
        num_rounds = len(schedule_result)
        
        d1_stats = {"points": 0.0, "grids": [], "finishes": [], "podiums": 0, "wins": 0, "dnfs": 0}
        d2_stats = {"points": 0.0, "grids": [], "finishes": [], "podiums": 0, "wins": 0, "dnfs": 0}
        
        h2h_wins = 0
        h2h_losses = 0
        
        def find_driver_row(df, key):
            if "driverCode" in df.columns:
                m = df[df["driverCode"].astype(str).str.upper() == key.upper()]
                if not m.empty: return m.iloc[0]
            if "driverId" in df.columns:
                m = df[df["driverId"].astype(str).str.lower() == key.lower()]
                if not m.empty: return m.iloc[0]
                m = df[df["driverId"].astype(str).str.contains(key.lower(), na=False)]
                if not m.empty: return m.iloc[0]
            return None

        # Loop through completed rounds
        for rnd in range(1, num_rounds + 1):
            try:
                result = ergast.get_race_results(season=year, round=rnd)
                if not result.content:
                    continue
                race_df = result.content[0]
                
                row1 = find_driver_row(race_df, driver1)
                row2 = find_driver_row(race_df, driver2)
                
                if row1 is None and row2 is None:
                    continue
                
                d1_pos, d2_pos = None, None
                
                if row1 is not None:
                    d1_stats["points"] += float(row1.get("points", 0))
                    grid = int(row1.get("grid", 0)) if pd.notna(row1.get("grid")) else None
                    if grid is not None: d1_stats["grids"].append(grid)
                    
                    pos_val = row1.get("position")
                    status = str(row1.get("status", "")).lower()
                    is_retired = "finish" not in status and "lap" not in status
                    
                    if pd.notna(pos_val) and not is_retired:
                        pos = int(pos_val)
                        d1_stats["finishes"].append(pos)
                        d1_pos = pos
                        if pos == 1: d1_stats["wins"] += 1
                        if pos <= 3: d1_stats["podiums"] += 1
                    else:
                        d1_stats["dnfs"] += 1
                        
                if row2 is not None:
                    d2_stats["points"] += float(row2.get("points", 0))
                    grid = int(row2.get("grid", 0)) if pd.notna(row2.get("grid")) else None
                    if grid is not None: d2_stats["grids"].append(grid)
                    
                    pos_val = row2.get("position")
                    status = str(row2.get("status", "")).lower()
                    is_retired = "finish" not in status and "lap" not in status
                    
                    if pd.notna(pos_val) and not is_retired:
                        pos = int(pos_val)
                        d2_stats["finishes"].append(pos)
                        d2_pos = pos
                        if pos == 1: d2_stats["wins"] += 1
                        if pos <= 3: d2_stats["podiums"] += 1
                    else:
                        d2_stats["dnfs"] += 1
                        
                # Head to Head comparison for finishing position
                if d1_pos is not None and d2_pos is not None:
                    if d1_pos < d2_pos:
                        h2h_wins += 1
                    elif d2_pos < d1_pos:
                        h2h_losses += 1
                elif d1_pos is not None and d2_pos is None:
                    h2h_wins += 1
                elif d2_pos is not None and d1_pos is None:
                    h2h_losses += 1
            except Exception:
                continue
                
        d1_avg_grid = float(np.mean(d1_stats["grids"])) if d1_stats["grids"] else None
        d1_avg_finish = float(np.mean(d1_stats["finishes"])) if d1_stats["finishes"] else None
        d2_avg_grid = float(np.mean(d2_stats["grids"])) if d2_stats["grids"] else None
        d2_avg_finish = float(np.mean(d2_stats["finishes"])) if d2_stats["finishes"] else None
        
        return {
            "driver1": {
                "code": driver1.upper(),
                "points": d1_stats["points"],
                "avg_grid": round(d1_avg_grid, 2) if d1_avg_grid else None,
                "avg_finish": round(d1_avg_finish, 2) if d1_avg_finish else None,
                "wins": d1_stats["wins"],
                "podiums": d1_stats["podiums"],
                "dnfs": d1_stats["dnfs"],
            },
            "driver2": {
                "code": driver2.upper(),
                "points": d2_stats["points"],
                "avg_grid": round(d2_avg_grid, 2) if d2_avg_grid else None,
                "avg_finish": round(d2_avg_finish, 2) if d2_avg_finish else None,
                "wins": d2_stats["wins"],
                "podiums": d2_stats["podiums"],
                "dnfs": d2_stats["dnfs"],
            },
            "h2h": {
                "d1_ahead": h2h_wins,
                "d2_ahead": h2h_losses
            }
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


# ================= WEBSOCKET (LIVE TIMING) =================

@app.websocket("/ws/live-timing")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket foundation for streaming live timing/telemetry data to the frontend.
    Currently set up to simulate incoming data until integrated with FastF1 SignalR.
    """
    await websocket.accept()
    try:
        # In a real scenario, this would listen to an event bus or FastF1 live timing client
        lap_count = 1
        while True:
            # Simulate real-time data
            simulated_data = {
                "type": "live_timing",
                "lap": lap_count,
                "leader": "VER",
                "gap": 1.23,
                "track_status": "Green"
            }
            await websocket.send_text(json.dumps(simulated_data))
            
            # Wait for 5 seconds before sending next update
            await asyncio.sleep(5)
            lap_count += 1
            
    except WebSocketDisconnect:
        print("Client disconnected from live timing")