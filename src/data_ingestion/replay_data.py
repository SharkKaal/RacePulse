"""
replay_data.py — Pre-compute frame-by-frame race replay data from FastF1 telemetry.

Generates synchronized position data for all drivers at regular time intervals,
simulates Safety Car positions from track status data, extracts track outlines
and DRS zones, and caches results for fast reload.
"""

import fastf1
import numpy as np
import pandas as pd
import json
import gzip
import os
import hashlib
from pathlib import Path

from src.data_ingestion.fastf1_loader import setup_cache

COMPUTED_DIR = "computed_data/replay"
FRAME_INTERVAL_MS = 500  # one frame every 500ms → 2 FPS base data, interpolated client-side


def _cache_path(year: int, race, session_type: str) -> Path:
    """Generate a deterministic cache file path."""
    key = f"{year}_{race}_{session_type}"
    safe = hashlib.md5(key.encode()).hexdigest()[:12]
    return Path(COMPUTED_DIR) / f"replay_{year}_{race}_{session_type}_{safe}.json.gz"


def compute_replay_data(year: int, race, session_type: str = "R", force_refresh: bool = False) -> dict:
    """
    Main entry point. Returns the full replay payload dict.
    Loads from cache if available, otherwise computes from FastF1.
    """
    cache_file = _cache_path(year, race, session_type)

    if not force_refresh and cache_file.exists():
        try:
            with gzip.open(cache_file, "rt", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass  # Recompute if cache is corrupted

    # Load session
    setup_cache()
    try:
        gp_val = int(race)
    except (ValueError, TypeError):
        gp_val = race
    session = fastf1.get_session(year, gp_val, session_type)
    session.load()

    # Build the payload
    track = _get_track_outline(session)
    drs_zones = _get_drs_zones(session)
    pit_lane = _get_pit_lane(session)
    drivers_info = _get_drivers_info(session)
    frames = _build_frame_data(session)
    
    # Safety car
    track_polyline = list(zip(track["x"], track["y"])) if track["x"] else []
    _compute_safety_car_positions(frames, session, track_polyline, pit_lane)

    total_laps = int(session.total_laps) if hasattr(session, "total_laps") and session.total_laps else 0
    if total_laps == 0 and frames:
        total_laps = max((f.get("lap", 0) for f in frames), default=0)

    payload = {
        "track": {
            "x": track["x"],
            "y": track["y"],
            "drs_zones": drs_zones,
            "pit_entry": pit_lane.get("entry"),
            "pit_exit": pit_lane.get("exit"),
            "pit_path": pit_lane.get("path"),
        },
        "frames": frames,
        "total_laps": total_laps,
        "total_frames": len(frames),
        "drivers": drivers_info,
    }

    # Cache
    os.makedirs(COMPUTED_DIR, exist_ok=True)
    try:
        with gzip.open(cache_file, "wt", encoding="utf-8") as f:
            json.dump(payload, f, separators=(",", ":"))
    except Exception as e:
        print(f"Warning: could not cache replay data: {e}")

    return payload


def _get_track_outline(session) -> dict:
    """Extract track reference line from the fastest lap position data."""
    try:
        fastest = session.laps.pick_fastest()
        pos = fastest.get_pos_data()
        x = pos["X"].to_numpy().tolist()
        y = pos["Y"].to_numpy().tolist()
        # Close the loop
        if len(x) > 2 and (abs(x[0] - x[-1]) > 50 or abs(y[0] - y[-1]) > 50):
            x.append(x[0])
            y.append(y[0])
        return {"x": x, "y": y}
    except Exception as e:
        print(f"Warning: could not extract track outline: {e}")
        return {"x": [], "y": []}


def _get_drs_zones(session) -> list:
    """Extract DRS zones from circuit info if available."""
    zones = []
    try:
        ci = session.get_circuit_info()
        if ci is not None and hasattr(ci, "corners"):
            # FastF1 doesn't always expose DRS zones directly
            # We can try to get them from marshal_sectors or other data
            pass
    except Exception:
        pass
    return zones


def _get_pit_lane(session) -> dict:
    """Extract approximate pit lane coordinates."""
    pit_info = {"entry": None, "exit": None, "path": None}
    try:
        fastest = session.laps.pick_fastest()
        pos = fastest.get_pos_data()
        x = pos["X"].to_numpy()
        y = pos["Y"].to_numpy()
        
        # Pit entry is roughly near the start/finish straight
        # Use the first/last few points as approximation
        if len(x) > 10:
            pit_info["entry"] = {"x": float(x[0]), "y": float(y[0])}
            pit_info["exit"] = {"x": float(x[5]), "y": float(y[5])}
    except Exception:
        pass
    return pit_info


def _get_drivers_info(session) -> list:
    """Get driver metadata."""
    results = session.results
    drivers = []
    for _, row in results.iterrows():
        drivers.append({
            "code": str(row.get("Abbreviation", "")),
            "name": f"{row.get('FirstName', '')} {row.get('LastName', '')}".strip(),
            "team": str(row.get("TeamName", "")),
            "team_color": f"#{row.get('TeamColor', 'ffffff')}" if pd.notna(row.get("TeamColor")) else "#ffffff",
            "number": str(row.get("DriverNumber", "")),
        })
    return drivers


def _build_frame_data(session) -> list:
    """
    Generate time-synchronized frames from driver telemetry.
    
    Approach:
    - Get all laps for the session
    - For each driver, load their entire telemetry dataset in one merged call
    - Vectorize the mapping of timestamps to lap numbers and tire compounds
    - Vectorize the interpolation of position coordinates, speed, gear, and DRS
    - Construct the unified frame list
    """
    laps = session.laps
    if laps.empty:
        return []
    
    results = session.results
    drivers = laps["Driver"].unique()
    
    driver_data = {}
    for driver in drivers:
        try:
            driver_laps = laps.pick_drivers(driver).sort_values("LapNumber")
            if driver_laps.empty:
                continue
            
            # Get driver metadata
            dr_info = results[results["Abbreviation"] == driver]
            team_color = f"#{dr_info.iloc[0]['TeamColor']}" if not dr_info.empty and pd.notna(dr_info.iloc[0].get("TeamColor")) else "#ffffff"
            team = str(dr_info.iloc[0]["TeamName"]) if not dr_info.empty else ""
            
            # Query the entire driver session telemetry in one single call (huge performance gain)
            tel_data = driver_laps.get_telemetry()
            if tel_data is None or tel_data.empty:
                continue
            
            if "SessionTime" not in tel_data.columns or "X" not in tel_data.columns or "Y" not in tel_data.columns:
                continue
            
            # Filter rows containing NaN coordinates or timestamps
            valid_mask = tel_data["SessionTime"].notna() & tel_data["X"].notna() & tel_data["Y"].notna()
            if not valid_mask.any():
                continue
            tel_data = tel_data[valid_mask]
            
            # Map telemetry SessionTimes to lap numbers and tire compounds in a vectorized manner
            lap_end_times = driver_laps["Time"].dt.total_seconds().to_numpy()
            lap_nums = driver_laps["LapNumber"].to_numpy()
            compounds = driver_laps["Compound"].to_numpy()
            
            times = tel_data["SessionTime"].dt.total_seconds().to_numpy()
            idx = np.searchsorted(lap_end_times, times)
            idx = np.clip(idx, 0, len(lap_nums) - 1)
            
            laps_array = lap_nums[idx]
            compounds_array = compounds[idx]
            
            x = tel_data["X"].to_numpy()
            y = tel_data["Y"].to_numpy()
            speeds = tel_data["Speed"].to_numpy() if "Speed" in tel_data.columns else np.zeros(len(times))
            gears = tel_data["nGear"].fillna(0).to_numpy() if "nGear" in tel_data.columns else np.zeros(len(times))
            drs = tel_data["DRS"].fillna(0).to_numpy() if "DRS" in tel_data.columns else np.zeros(len(times))
            
            # Ensure sorting by time
            sorted_idx = np.argsort(times)
            driver_data[driver] = {
                "team": team,
                "team_color": team_color,
                "times": times[sorted_idx],
                "x": x[sorted_idx],
                "y": y[sorted_idx],
                "speeds": speeds[sorted_idx],
                "gears": gears[sorted_idx],
                "drs": drs[sorted_idx],
                "laps": laps_array[sorted_idx],
                "compounds": compounds_array[sorted_idx],
                "last_lap": int(driver_laps["LapNumber"].max()),
                "status": str(results[results["Abbreviation"] == driver].iloc[0].get("Status", "")) if not results[results["Abbreviation"] == driver].empty else "",
            }
            
        except Exception as e:
            print(f"Warning: could not process driver {driver}: {e}")
            continue
            
    if not driver_data:
        return []
        
    # Determine global time range
    global_start = min(d["times"][0] for d in driver_data.values() if len(d["times"]) > 0)
    global_end = max(d["times"][-1] for d in driver_data.values() if len(d["times"]) > 0)
    
    # Generate frame timestamps
    interval_sec = FRAME_INTERVAL_MS / 1000.0
    frame_times = np.arange(global_start, global_end, interval_sec)
    
    # Cap frames if session length is excessively long
    if len(frame_times) > 7200:
        step = len(frame_times) / 7200
        indices = np.round(np.arange(0, len(frame_times), step)).astype(int)
        indices = indices[indices < len(frame_times)]
        frame_times = frame_times[indices]
        
    # Pre-interpolate each driver's telemetry values for all frame times (fully vectorized)
    driver_interpolated = {}
    for driver, dd in driver_data.items():
        times = dd["times"]
        if len(times) == 0:
            continue
            
        not_started_mask = frame_times < times[0]
        finished_mask = frame_times > times[-1]
        
        # Interpolate continuous variables
        interp_x = np.interp(frame_times, times, dd["x"])
        interp_y = np.interp(frame_times, times, dd["y"])
        interp_speed = np.interp(frame_times, times, dd["speeds"])
        
        # Round the discrete interpolations (gears and DRS)
        interp_gear = np.round(np.interp(frame_times, times, dd["gears"])).astype(int)
        interp_drs = np.round(np.interp(frame_times, times, dd["drs"])).astype(int)
        
        # Map indices for categorical properties (lap, compound)
        idx = np.searchsorted(times, frame_times)
        idx = np.clip(idx, 0, len(times) - 1)
        interp_lap = dd["laps"][idx].astype(int)
        interp_compound = dd["compounds"][idx]
        
        status_str = dd["status"].lower()
        is_finished = "finished" in status_str or "lapped" in status_str or status_str.startswith("+") or "lap" in status_str
        final_status = "finished" if is_finished else "out"
        
        driver_interpolated[driver] = {
            "team": dd["team"],
            "color": dd["team_color"],
            "not_started": not_started_mask,
            "finished": finished_mask,
            "x": interp_x,
            "y": interp_y,
            "speed": interp_speed,
            "gear": interp_gear,
            "drs": interp_drs,
            "lap": interp_lap,
            "compound": interp_compound,
            "final_status": final_status,
        }
        
    # Assemble structured frame objects
    frames = []
    for f_idx, t in enumerate(frame_times):
        frame_drivers = []
        max_lap = 0
        
        for driver, di in driver_interpolated.items():
            if di["not_started"][f_idx]:
                continue
                
            is_finished_or_retired = di["finished"][f_idx]
            
            if is_finished_or_retired:
                status = di["final_status"]
                x_val = di["x"][f_idx]
                y_val = di["y"][f_idx]
                speed = 0.0
                gear = 0
                drs = 0
                lap = di["lap"][f_idx]
                compound = di["compound"][f_idx]
            else:
                status = "running"
                x_val = di["x"][f_idx]
                y_val = di["y"][f_idx]
                speed = di["speed"][f_idx]
                gear = di["gear"][f_idx]
                drs = di["drs"][f_idx]
                lap = di["lap"][f_idx]
                compound = di["compound"][f_idx]
                
            max_lap = max(max_lap, lap)
            
            frame_drivers.append({
                "code": driver,
                "team": di["team"],
                "color": di["color"],
                "x": round(float(x_val), 1),
                "y": round(float(y_val), 1),
                "speed": round(float(speed), 1),
                "gear": int(gear),
                "drs": int(drs),
                "compound": str(compound),
                "status": status,
                "lap": int(lap),
            })
            
        # Sort by position (lap descending, code alphabetical)
        frame_drivers.sort(key=lambda d: (-d["lap"], d["code"]))
        for i, d in enumerate(frame_drivers):
            d["position"] = i + 1
            
        frames.append({
            "time": round(float(t - global_start), 2),
            "lap": int(max_lap),
            "drivers": frame_drivers,
            "safety_car": None,
        })
        
    return frames



def _compute_safety_car_positions(frames: list, session, track_polyline: list, pit_lane: dict):
    """
    Add Safety Car position data to frames based on track status.
    
    SC is deployed when track_status code is '4' (Safety Car).
    The SC position is simulated ~500m ahead of the race leader on the track polyline.
    """
    if not frames or not track_polyline:
        return
    
    # Get track status data
    try:
        track_status = session.track_status
        if track_status is None or track_status.empty:
            return
    except Exception:
        return
    
    # Build cumulative distance along the track polyline
    poly = np.array(track_polyline)
    diffs = np.diff(poly, axis=0)
    seg_lengths = np.sqrt((diffs ** 2).sum(axis=1))
    cum_dist = np.concatenate([[0], np.cumsum(seg_lengths)])
    total_track_length = cum_dist[-1] if len(cum_dist) > 0 else 1
    
    # Parse track status events
    sc_periods = []
    sc_start = None
    
    for _, status in track_status.iterrows():
        code = str(status.get("Status", ""))
        time_val = status.get("Time") or status.get("SessionTime")
        if time_val is None:
            continue
        t_sec = time_val.total_seconds() if hasattr(time_val, 'total_seconds') else 0
        
        if code == "4" and sc_start is None:  # SC deployed
            sc_start = t_sec
        elif code != "4" and sc_start is not None:  # SC ending
            sc_periods.append((sc_start, t_sec))
            sc_start = None
    
    if sc_start is not None:
        # SC still out at end
        sc_periods.append((sc_start, frames[-1]["time"] if frames else sc_start + 60))
    
    if not sc_periods:
        return
    
    # For each frame, check if SC is active
    DEPLOY_DURATION = 3.0  # seconds for deploy/return animation
    SC_OFFSET_M = 500  # meters ahead of leader
    
    # Find the reference start time (first frame time)
    ref_start = frames[0]["time"] if frames else 0
    
    for frame in frames:
        frame_time = frame["time"]
        sc_data = None
        
        for sc_begin, sc_end in sc_periods:
            # Normalize to frame time
            sc_begin_rel = sc_begin - ref_start if sc_begin > ref_start else sc_begin
            sc_end_rel = sc_end - ref_start if sc_end > ref_start else sc_end
            
            if frame_time < sc_begin_rel - 0.5 or frame_time > sc_end_rel + DEPLOY_DURATION + 0.5:
                continue
            
            # Determine phase
            if frame_time < sc_begin_rel + DEPLOY_DURATION:
                phase = "deploying"
                alpha = min(1.0, (frame_time - sc_begin_rel + 0.5) / DEPLOY_DURATION)
            elif frame_time > sc_end_rel:
                phase = "returning"
                alpha = max(0.0, 1.0 - (frame_time - sc_end_rel) / DEPLOY_DURATION)
            else:
                phase = "on_track"
                alpha = 1.0
            
            # Find leader position
            leader = None
            for d in frame["drivers"]:
                if d["status"] == "running":
                    leader = d
                    break
            
            if leader is None:
                continue
            
            # Find closest point on track polyline to leader
            leader_pos = np.array([leader["x"], leader["y"]])
            distances = np.sqrt(((poly - leader_pos) ** 2).sum(axis=1))
            closest_idx = np.argmin(distances)
            leader_track_dist = cum_dist[closest_idx]
            
            # Place SC ahead by SC_OFFSET_M
            sc_track_dist = (leader_track_dist + SC_OFFSET_M) % total_track_length
            
            # Find position on polyline at sc_track_dist
            sc_idx = np.searchsorted(cum_dist, sc_track_dist)
            if sc_idx >= len(poly):
                sc_idx = len(poly) - 1
            
            if phase == "deploying" and pit_lane.get("entry"):
                # Interpolate from pit lane to track position
                pit_pos = np.array([pit_lane["entry"]["x"], pit_lane["entry"]["y"]])
                track_pos = poly[sc_idx]
                frac = alpha
                sc_pos = pit_pos + frac * (track_pos - pit_pos)
            elif phase == "returning" and pit_lane.get("entry"):
                # Interpolate from track position to pit lane
                pit_pos = np.array([pit_lane["entry"]["x"], pit_lane["entry"]["y"]])
                track_pos = poly[sc_idx]
                frac = alpha
                sc_pos = pit_pos + (1 - frac) * (track_pos - pit_pos) + frac * pit_pos
                sc_pos = track_pos + (1 - frac) * (pit_pos - track_pos)
            else:
                sc_pos = poly[sc_idx]
            
            sc_data = {
                "x": round(float(sc_pos[0]), 1),
                "y": round(float(sc_pos[1]), 1),
                "phase": phase,
                "alpha": round(float(max(0, min(1, alpha))), 2),
            }
            break
        
        frame["safety_car"] = sc_data


def get_replay_track(year: int, race, session_type: str = "R") -> dict:
    """Get just the track outline data (lighter endpoint)."""
    setup_cache()
    try:
        gp_val = int(race)
    except (ValueError, TypeError):
        gp_val = race
    session = fastf1.get_session(year, gp_val, session_type)
    session.load()
    
    track = _get_track_outline(session)
    drs_zones = _get_drs_zones(session)
    pit_lane = _get_pit_lane(session)
    
    return {
        "x": track["x"],
        "y": track["y"],
        "drs_zones": drs_zones,
        "pit_entry": pit_lane.get("entry"),
        "pit_exit": pit_lane.get("exit"),
        "pit_path": pit_lane.get("path"),
    }
