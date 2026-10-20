import fastf1
import os
import pandas as pd
import numpy as np

CACHE_DIR = "data/external/cache"

def setup_cache():
    if not os.path.exists(CACHE_DIR):
        os.makedirs(CACHE_DIR)
    fastf1.Cache.enable_cache(CACHE_DIR)

def load_session(year: int, gp: str, session_type: str = 'R'):
    """Load and return a FastF1 session object."""
    setup_cache()
    try:
        gp_val = int(gp)
    except (ValueError, TypeError):
        gp_val = gp
    session = fastf1.get_session(year, gp_val, session_type)
    session.load()
    return session

def get_session_info(year: int, gp: str, session_type: str = 'R'):
    """
    Get session metadata: event name, date, location, circuit info.
    """
    setup_cache()
    try:
        gp_val = int(gp)
    except (ValueError, TypeError):
        gp_val = gp
    session = fastf1.get_session(year, gp_val, session_type)
    session.load()

    event = session.event
    info = {
        "event_name": str(event.get("EventName", gp)),
        "country": str(event.get("Country", "")),
        "location": str(event.get("Location", "")),
        "circuit": str(event.get("OfficialEventName", "")),
        "round": int(event.get("RoundNumber", 0)),
        "date": str(session.date) if session.date else "",
        "session_type": session_type,
        "year": year,
        "total_laps": int(session.total_laps) if hasattr(session, 'total_laps') and session.total_laps else 0,
    }

    return info, session

def get_all_laps(session):
    """
    Get lap-by-lap data for all drivers in a session.
    Returns a list of dicts with lap times, sector times, tyre info.
    """
    laps = session.laps

    records = []
    for _, lap in laps.iterrows():
        record = {
            "driver": str(lap.get("Driver", "")),
            "team": str(lap.get("Team", "")),
            "lap_number": int(lap.get("LapNumber", 0)),
            "lap_time_sec": lap["LapTime"].total_seconds() if pd.notna(lap.get("LapTime")) and hasattr(lap["LapTime"], 'total_seconds') else None,
            "sector1_sec": lap["Sector1Time"].total_seconds() if pd.notna(lap.get("Sector1Time")) and hasattr(lap["Sector1Time"], 'total_seconds') else None,
            "sector2_sec": lap["Sector2Time"].total_seconds() if pd.notna(lap.get("Sector2Time")) and hasattr(lap["Sector2Time"], 'total_seconds') else None,
            "sector3_sec": lap["Sector3Time"].total_seconds() if pd.notna(lap.get("Sector3Time")) and hasattr(lap["Sector3Time"], 'total_seconds') else None,
            "compound": str(lap.get("Compound", "")) if pd.notna(lap.get("Compound")) else "",
            "tyre_life": int(lap.get("TyreLife", 0)) if pd.notna(lap.get("TyreLife")) else 0,
            "stint": int(lap.get("Stint", 0)) if pd.notna(lap.get("Stint")) else 0,
            "is_pit_out": bool(lap.get("PitOutTime") is not pd.NaT) if "PitOutTime" in lap.index else False,
            "is_pit_in": bool(lap.get("PitInTime") is not pd.NaT) if "PitInTime" in lap.index else False,
            "position": int(lap.get("Position", 0)) if pd.notna(lap.get("Position")) else None,
            "speed_i1": float(lap.get("SpeedI1", 0)) if pd.notna(lap.get("SpeedI1")) else None,
            "speed_i2": float(lap.get("SpeedI2", 0)) if pd.notna(lap.get("SpeedI2")) else None,
            "speed_fl": float(lap.get("SpeedFL", 0)) if pd.notna(lap.get("SpeedFL")) else None,
            "speed_st": float(lap.get("SpeedST", 0)) if pd.notna(lap.get("SpeedST")) else None,
        }
        records.append(record)

    return records

def get_race_results(session):
    """
    Get race results from session.
    """
    results = session.results
    records = []

    for _, row in results.iterrows():
        record = {
            "position": int(row.get("Position", 0)) if pd.notna(row.get("Position")) else None,
            "driver_number": str(row.get("DriverNumber", "")),
            "driver_code": str(row.get("Abbreviation", "")),
            "driver_name": f"{row.get('FirstName', '')} {row.get('LastName', '')}".strip(),
            "team": str(row.get("TeamName", "")),
            "team_color": f"#{row.get('TeamColor', 'ffffff')}" if pd.notna(row.get("TeamColor")) else "#ffffff",
            "grid_position": int(row.get("GridPosition", 0)) if pd.notna(row.get("GridPosition")) else None,
            "status": str(row.get("Status", "")),
            "points": float(row.get("Points", 0)) if pd.notna(row.get("Points")) else 0,
            "time": str(row.get("Time", "")) if pd.notna(row.get("Time")) else "",
        }
        records.append(record)

    return records

def get_dnfs(session):
    """
    Extract DNFs (retirements, DNS, DSQ) from the session results.
    """
    results = session.results
    records = []
    for _, row in results.iterrows():
        status = str(row.get("Status", ""))
        classified_pos = str(row.get("ClassifiedPosition", ""))
        
        is_dnf = False
        if classified_pos in ["R", "D", "N"]:
            is_dnf = True
        elif status not in ["Finished", "Classified", "Lapped"] and not status.startswith("+") and not "Lap" in status:
            is_dnf = True
            
        if is_dnf:
            records.append({
                "driver_code": str(row.get("Abbreviation", "")),
                "driver_name": f"{row.get('FirstName', '')} {row.get('LastName', '')}".strip(),
                "team": str(row.get("TeamName", "")),
                "team_color": f"#{row.get('TeamColor', 'ffffff')}" if pd.notna(row.get("TeamColor")) else "#ffffff",
                "laps": int(row.get("Laps", 0)) if pd.notna(row.get("Laps")) else 0,
                "status": status
            })
    return records

def get_qualifying_results(year: int, gp: str):
    """
    Get qualifying session results with Q1/Q2/Q3 times.
    """
    setup_cache()
    try:
        gp_val = int(gp)
    except (ValueError, TypeError):
        gp_val = gp
    session = fastf1.get_session(year, gp_val, 'Q')
    session.load()

    results = session.results
    records = []

    for _, row in results.iterrows():
        record = {
            "position": int(row.get("Position", 0)) if pd.notna(row.get("Position")) else None,
            "driver_code": str(row.get("Abbreviation", "")),
            "driver_name": f"{row.get('FirstName', '')} {row.get('LastName', '')}".strip(),
            "team": str(row.get("TeamName", "")),
            "team_color": f"#{row.get('TeamColor', 'ffffff')}" if pd.notna(row.get("TeamColor")) else "#ffffff",
            "q1": row["Q1"].total_seconds() if pd.notna(row.get("Q1")) and hasattr(row["Q1"], 'total_seconds') else None,
            "q2": row["Q2"].total_seconds() if pd.notna(row.get("Q2")) and hasattr(row["Q2"], 'total_seconds') else None,
            "q3": row["Q3"].total_seconds() if pd.notna(row.get("Q3")) and hasattr(row["Q3"], 'total_seconds') else None,
        }
        records.append(record)

    return records

def get_session_weather(session):
    """
    Get weather data throughout the session.
    """
    weather = session.weather_data
    if weather is None or weather.empty:
        return []

    records = []
    for _, row in weather.iterrows():
        record = {
            "time_sec": row["Time"].total_seconds() if pd.notna(row.get("Time")) and hasattr(row["Time"], 'total_seconds') else 0,
            "air_temp": float(row.get("AirTemp", 0)) if pd.notna(row.get("AirTemp")) else None,
            "track_temp": float(row.get("TrackTemp", 0)) if pd.notna(row.get("TrackTemp")) else None,
            "humidity": float(row.get("Humidity", 0)) if pd.notna(row.get("Humidity")) else None,
            "wind_speed": float(row.get("WindSpeed", 0)) if pd.notna(row.get("WindSpeed")) else None,
            "wind_direction": float(row.get("WindDirection", 0)) if pd.notna(row.get("WindDirection")) else None,
            "pressure": float(row.get("Pressure", 0)) if pd.notna(row.get("Pressure")) else None,
            "rainfall": bool(row.get("Rainfall", False)) if pd.notna(row.get("Rainfall")) else False,
        }
        records.append(record)

    return records

def get_tyre_stints(session):
    """
    Calculate tyre strategy stints per driver.
    Returns stint data: driver, stint number, compound, start lap, end lap, stint length.
    """
    laps = session.laps
    drivers = laps["Driver"].unique()

    stints = []
    for driver in drivers:
        driver_laps = laps.pick_drivers(driver).sort_values("LapNumber")
        if driver_laps.empty:
            continue

        team = str(driver_laps.iloc[0].get("Team", ""))

        for stint_num in driver_laps["Stint"].unique():
            if pd.isna(stint_num):
                continue
            stint_laps = driver_laps[driver_laps["Stint"] == stint_num]
            if stint_laps.empty:
                continue

            compound = str(stint_laps.iloc[0].get("Compound", "UNKNOWN"))
            start_lap = int(stint_laps["LapNumber"].min())
            end_lap = int(stint_laps["LapNumber"].max())
            stint_length = end_lap - start_lap + 1

            # Get lap times for degradation
            lap_times = []
            for _, lap in stint_laps.iterrows():
                lt = lap.get("LapTime")
                if pd.notna(lt) and hasattr(lt, 'total_seconds'):
                    lap_times.append(lt.total_seconds())
                else:
                    lap_times.append(None)

            stints.append({
                "driver": str(driver),
                "team": team,
                "stint": int(stint_num),
                "compound": compound,
                "start_lap": start_lap,
                "end_lap": end_lap,
                "stint_length": stint_length,
                "lap_times": lap_times,
            })

    return stints

def get_event_schedule(year: int):
    """
    Get the full event schedule for a season.
    """
    setup_cache()
    schedule = fastf1.get_event_schedule(year)
    events = []

    for _, event in schedule.iterrows():
        if pd.notna(event.get("EventName")):
            sessions = []
            for i in range(1, 6):
                s_name = event.get(f"Session{i}")
                s_date = event.get(f"Session{i}DateUtc")
                if pd.notna(s_name) and s_name:
                    sessions.append({
                        "name": str(s_name),
                        "date": s_date.isoformat() if pd.notna(s_date) else ""
                    })
            events.append({
                "round": int(event.get("RoundNumber", 0)),
                "name": str(event.get("EventName", "")),
                "official_name": str(event.get("OfficialEventName", "")),
                "country": str(event.get("Country", "")),
                "location": str(event.get("Location", "")),
                "date": str(event.get("EventDate", ""))[:10] if pd.notna(event.get("EventDate")) else "",
                "sessions": sessions
            })

    return events

def get_drivers_for_session(session):
    """
    Get list of drivers that participated in a session.
    """
    results = session.results
    drivers = []

    for _, row in results.iterrows():
        drivers.append({
            "code": str(row.get("Abbreviation", "")),
            "number": str(row.get("DriverNumber", "")),
            "name": f"{row.get('FirstName', '')} {row.get('LastName', '')}".strip(),
            "team": str(row.get("TeamName", "")),
            "team_color": f"#{row.get('TeamColor', 'ffffff')}" if pd.notna(row.get("TeamColor")) else "#ffffff",
        })

    return drivers


def get_speed_trap_data(session):
    """
    Extract maximum speed at each speed trap per driver.
    Speed traps: I1 (Intermediate 1), I2 (Intermediate 2), FL (Finish Line), ST (Speed Trap).
    """
    laps = session.laps
    drivers = laps["Driver"].unique()
    results = session.results

    records = []
    for driver in drivers:
        driver_laps = laps.pick_drivers(driver)
        if driver_laps.empty:
            continue

        # Get driver info
        dr_info = results[results["Abbreviation"] == driver]
        team = str(dr_info.iloc[0]["TeamName"]) if not dr_info.empty else ""
        team_color = f"#{dr_info.iloc[0]['TeamColor']}" if not dr_info.empty and pd.notna(dr_info.iloc[0].get("TeamColor")) else "#ffffff"

        # Extract max speeds at each trap
        speed_i1 = driver_laps["SpeedI1"].dropna()
        speed_i2 = driver_laps["SpeedI2"].dropna()
        speed_fl = driver_laps["SpeedFL"].dropna()
        speed_st = driver_laps["SpeedST"].dropna()

        records.append({
            "driver": str(driver),
            "team": team,
            "team_color": team_color,
            "max_speed_i1": float(speed_i1.max()) if not speed_i1.empty else None,
            "max_speed_i2": float(speed_i2.max()) if not speed_i2.empty else None,
            "max_speed_fl": float(speed_fl.max()) if not speed_fl.empty else None,
            "max_speed_st": float(speed_st.max()) if not speed_st.empty else None,
            "avg_speed_st": round(float(speed_st.mean()), 1) if not speed_st.empty else None,
        })

    # Sort by max speed trap speed
    records.sort(key=lambda x: x.get("max_speed_st") or 0, reverse=True)
    return records


def get_grid_vs_finish(session):
    """
    Returns grid position vs final position for each driver.
    """
    results = session.results
    records = []

    for _, row in results.iterrows():
        grid = int(row.get("GridPosition", 0)) if pd.notna(row.get("GridPosition")) else None
        finish = int(row.get("Position", 0)) if pd.notna(row.get("Position")) else None
        if grid is None or finish is None:
            continue

        records.append({
            "driver": str(row.get("Abbreviation", "")),
            "driver_name": f"{row.get('FirstName', '')} {row.get('LastName', '')}".strip(),
            "team": str(row.get("TeamName", "")),
            "team_color": f"#{row.get('TeamColor', 'ffffff')}" if pd.notna(row.get("TeamColor")) else "#ffffff",
            "grid": grid,
            "finish": finish,
            "change": grid - finish,  # positive = gained positions
            "status": str(row.get("Status", "")),
        })

    records.sort(key=lambda x: x["finish"])
    return records


def get_pit_stop_data(session):
    """
    Extract pit stop data from FastF1 session laps.
    Calculates pit stop duration from PitInTime and PitOutTime.
    """
    laps = session.laps
    drivers = laps["Driver"].unique()
    results = session.results

    records = []
    for driver in drivers:
        driver_laps = laps.pick_drivers(driver).sort_values("LapNumber")
        if driver_laps.empty:
            continue

        dr_info = results[results["Abbreviation"] == driver]
        team = str(dr_info.iloc[0]["TeamName"]) if not dr_info.empty else ""
        team_color = f"#{dr_info.iloc[0]['TeamColor']}" if not dr_info.empty and pd.notna(dr_info.iloc[0].get("TeamColor")) else "#ffffff"

        stop_num = 0
        for _, lap in driver_laps.iterrows():
            pit_in = lap.get("PitInTime")
            pit_out = lap.get("PitOutTime")

            # Detect pit stop: pit_in on one lap means driver pitted at end of that lap
            if pd.notna(pit_in):
                stop_num += 1
                # Try to get pit out from next lap for duration
                next_laps = driver_laps[driver_laps["LapNumber"] == lap["LapNumber"] + 1]
                duration = None
                if not next_laps.empty:
                    next_pit_out = next_laps.iloc[0].get("PitOutTime")
                    if pd.notna(next_pit_out) and pd.notna(pit_in):
                        try:
                            duration = (next_pit_out - pit_in).total_seconds()
                        except Exception:
                            pass

                # Get compound change
                current_compound = str(lap.get("Compound", "")) if pd.notna(lap.get("Compound")) else ""
                next_compound = ""
                if not next_laps.empty:
                    next_compound = str(next_laps.iloc[0].get("Compound", "")) if pd.notna(next_laps.iloc[0].get("Compound")) else ""

                records.append({
                    "driver": str(driver),
                    "team": team,
                    "team_color": team_color,
                    "stop": stop_num,
                    "lap": int(lap["LapNumber"]),
                    "duration": round(duration, 2) if duration else None,
                    "compound_from": current_compound,
                    "compound_to": next_compound,
                })

    records.sort(key=lambda x: (x["lap"], x["driver"]))
    return records


def get_tyre_degradation(session):
    """
    Returns lap times vs tyre age per compound per driver.
    Filters out pit in/out laps and outliers.
    """
    laps = session.laps
    drivers = laps["Driver"].unique()
    results = session.results

    records = []
    for driver in drivers:
        driver_laps = laps.pick_drivers(driver).sort_values("LapNumber")
        if driver_laps.empty:
            continue

        dr_info = results[results["Abbreviation"] == driver]
        team_color = f"#{dr_info.iloc[0]['TeamColor']}" if not dr_info.empty and pd.notna(dr_info.iloc[0].get("TeamColor")) else "#ffffff"

        for _, lap in driver_laps.iterrows():
            lt = lap.get("LapTime")
            if not pd.notna(lt) or not hasattr(lt, 'total_seconds'):
                continue

            lap_time_sec = lt.total_seconds()

            # Filter outliers (pit laps, safety car laps, etc.)
            if lap_time_sec > 200 or lap_time_sec < 50:
                continue

            # Skip pit in/out laps
            if pd.notna(lap.get("PitInTime")) or pd.notna(lap.get("PitOutTime")):
                continue

            compound = str(lap.get("Compound", "UNKNOWN")) if pd.notna(lap.get("Compound")) else "UNKNOWN"
            tyre_life = int(lap.get("TyreLife", 0)) if pd.notna(lap.get("TyreLife")) else 0

            records.append({
                "driver": str(driver),
                "team_color": team_color,
                "compound": compound,
                "tyre_life": tyre_life,
                "lap_time_sec": round(lap_time_sec, 3),
                "lap_number": int(lap.get("LapNumber", 0)),
            })

    return records


def get_fastest_laps_board(session):
    """
    Returns personal best lap and sector times per driver with classification.
    Purple = overall best, Green = personal best.
    """
    laps = session.laps
    results = session.results
    drivers = laps["Driver"].unique()

    records = []
    for driver in drivers:
        driver_laps = laps.pick_drivers(driver)
        if driver_laps.empty:
            continue

        dr_info = results[results["Abbreviation"] == driver]
        team = str(dr_info.iloc[0]["TeamName"]) if not dr_info.empty else ""
        team_color = f"#{dr_info.iloc[0]['TeamColor']}" if not dr_info.empty and pd.notna(dr_info.iloc[0].get("TeamColor")) else "#ffffff"

        # Find personal best lap
        valid_laps = driver_laps.dropna(subset=["LapTime"])
        if valid_laps.empty:
            continue

        best_lap = valid_laps.loc[valid_laps["LapTime"].idxmin()]
        best_time = best_lap["LapTime"].total_seconds() if pd.notna(best_lap.get("LapTime")) and hasattr(best_lap["LapTime"], 'total_seconds') else None

        # Best sectors
        s1_times = driver_laps["Sector1Time"].dropna()
        s2_times = driver_laps["Sector2Time"].dropna()
        s3_times = driver_laps["Sector3Time"].dropna()

        best_s1 = s1_times.min().total_seconds() if not s1_times.empty and hasattr(s1_times.min(), 'total_seconds') else None
        best_s2 = s2_times.min().total_seconds() if not s2_times.empty and hasattr(s2_times.min(), 'total_seconds') else None
        best_s3 = s3_times.min().total_seconds() if not s3_times.empty and hasattr(s3_times.min(), 'total_seconds') else None

        records.append({
            "driver": str(driver),
            "team": team,
            "team_color": team_color,
            "best_lap": round(best_time, 3) if best_time else None,
            "best_lap_number": int(best_lap.get("LapNumber", 0)),
            "best_s1": round(best_s1, 3) if best_s1 else None,
            "best_s2": round(best_s2, 3) if best_s2 else None,
            "best_s3": round(best_s3, 3) if best_s3 else None,
            "compound": str(best_lap.get("Compound", "")) if pd.notna(best_lap.get("Compound")) else "",
        })

    # Sort by best lap time
    records.sort(key=lambda x: x["best_lap"] if x["best_lap"] else 9999)

    # Mark overall bests (purple)
    if records:
        all_s1 = [r["best_s1"] for r in records if r["best_s1"]]
        all_s2 = [r["best_s2"] for r in records if r["best_s2"]]
        all_s3 = [r["best_s3"] for r in records if r["best_s3"]]
        all_laps = [r["best_lap"] for r in records if r["best_lap"]]

        overall_s1 = min(all_s1) if all_s1 else None
        overall_s2 = min(all_s2) if all_s2 else None
        overall_s3 = min(all_s3) if all_s3 else None
        overall_lap = min(all_laps) if all_laps else None

        for r in records:
            r["is_purple_s1"] = r["best_s1"] == overall_s1 if r["best_s1"] and overall_s1 else False
            r["is_purple_s2"] = r["best_s2"] == overall_s2 if r["best_s2"] and overall_s2 else False
            r["is_purple_s3"] = r["best_s3"] == overall_s3 if r["best_s3"] and overall_s3 else False
            r["is_purple_lap"] = r["best_lap"] == overall_lap if r["best_lap"] and overall_lap else False

    return records


def get_clean_race_pace(session):
    """
    Returns cleaned race pace per driver.
    Excludes: first lap, pit in/out laps, laps > 110% of median.
    """
    laps = session.laps
    results = session.results
    drivers = laps["Driver"].unique()

    records = []
    for driver in drivers:
        driver_laps = laps.pick_drivers(driver).sort_values("LapNumber")
        if driver_laps.empty:
            continue

        dr_info = results[results["Abbreviation"] == driver]
        team = str(dr_info.iloc[0]["TeamName"]) if not dr_info.empty else ""
        team_color = f"#{dr_info.iloc[0]['TeamColor']}" if not dr_info.empty and pd.notna(dr_info.iloc[0].get("TeamColor")) else "#ffffff"
        position = int(dr_info.iloc[0].get("Position", 0)) if not dr_info.empty and pd.notna(dr_info.iloc[0].get("Position")) else None

        # Collect valid lap times
        lap_times = []
        for _, lap in driver_laps.iterrows():
            lt = lap.get("LapTime")
            if not pd.notna(lt) or not hasattr(lt, 'total_seconds'):
                continue
            t = lt.total_seconds()

            # Skip first lap, pit laps
            if lap.get("LapNumber", 0) <= 1:
                continue
            if pd.notna(lap.get("PitInTime")) or pd.notna(lap.get("PitOutTime")):
                continue
            if t > 200 or t < 50:
                continue

            lap_times.append(t)

        if not lap_times:
            continue

        # Filter outliers: > 107% of median
        median_time = float(np.median(lap_times))
        clean_times = [t for t in lap_times if t <= median_time * 1.07]

        if not clean_times:
            continue

        records.append({
            "driver": str(driver),
            "team": team,
            "team_color": team_color,
            "position": position,
            "lap_times": [round(t, 3) for t in clean_times],
            "median": round(float(np.median(clean_times)), 3),
            "mean": round(float(np.mean(clean_times)), 3),
            "std": round(float(np.std(clean_times)), 3),
            "min": round(float(min(clean_times)), 3),
            "max": round(float(max(clean_times)), 3),
            "count": len(clean_times),
        })

    records.sort(key=lambda x: x["median"])
    return records


def get_track_evolution(session):
    """
    Returns the fastest lap time per lap number across all drivers.
    Shows how the track improves over the session.
    """
    laps = session.laps
    max_lap = int(laps["LapNumber"].max()) if not laps.empty else 0

    records = []
    for lap_num in range(1, max_lap + 1):
        lap_data = laps[laps["LapNumber"] == lap_num]
        valid_times = []
        for _, lap in lap_data.iterrows():
            lt = lap.get("LapTime")
            if pd.notna(lt) and hasattr(lt, 'total_seconds'):
                t = lt.total_seconds()
                if 50 < t < 200:
                    valid_times.append(t)

        if valid_times:
            records.append({
                "lap_number": lap_num,
                "fastest": round(min(valid_times), 3),
                "median": round(float(np.median(valid_times)), 3),
                "driver_count": len(valid_times),
            })

    return records