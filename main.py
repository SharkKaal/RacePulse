from src.data_ingestion.fastf1_loader import load_session
from src.analytics.realtime_analysis import compare_drivers
from src.visualization.telemetry_plots import plot_speed_comparison

def main():
    print("Loading Monaco 2024 session telemetry...")
    session = load_session(2024, 'Monaco')

    print("Comparing fastest lap telemetry between VER and LEC...")
    tel1, tel2 = compare_drivers(session, 'VER', 'LEC')

    print("Opening speed and telemetry comparison plot...")
    plot_speed_comparison(tel1, tel2, 'VER', 'LEC')


if __name__ == "__main__":
    main()