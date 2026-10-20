import pandas as pd

def clean_lap_data(laps):
    laps = laps.dropna(subset=['LapTime'])
    laps = laps.reset_index(drop=True)
    return laps


def normalize_lap_times(laps):
    laps['LapTimeSeconds'] = laps['LapTime'].dt.total_seconds()
    return laps