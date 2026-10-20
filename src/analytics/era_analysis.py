import pandas as pd

def compute_driver_stats(results_df):
    stats = results_df.groupby('driver').agg({
        'points': 'sum',
        'position': 'mean'
    }).reset_index()

    return stats.sort_values(by='points', ascending=False)