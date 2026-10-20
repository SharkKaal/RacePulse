import pandas as pd

def analyze_pitstops(pitstop_file, results_file):
    pitstops = pd.read_csv(pitstop_file)
    results = pd.read_csv(results_file)

    merged = pitstops.merge(results, on=['raceId', 'driverId'])

    avg_pit = merged.groupby('driverId')['milliseconds'].mean()
    avg_position = merged.groupby('driverId')['position'].mean()

    return avg_pit, avg_position