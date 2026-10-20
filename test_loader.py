from src.data_ingestion.fastf1_loader import load_session
from src.visualization.telemetry_plots import plot_full_comparison

session = load_session(2024, "Monaco")

# Get laps
laps_ver = session.laps.pick_drivers("VER")
laps_ver = laps_ver[laps_ver["LapTime"].notna()]
lap1 = laps_ver.pick_fastest()

laps_lec = session.laps.pick_drivers("LEC")
laps_lec = laps_lec[laps_lec["LapTime"].notna()]
lap2 = laps_lec.pick_fastest()

# Get telemetry
tel1 = lap1.get_telemetry()
tel2 = lap2.get_telemetry()

if __name__ == "__main__":
    # Call plot comparison
    plot_full_comparison(
        tel1, tel2,
        "VER", "LEC"
    )