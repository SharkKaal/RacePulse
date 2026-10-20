import pandas as pd
import numpy as np
from src.preprocessing.clean_data import clean_lap_data, normalize_lap_times
from src.preprocessing.feature_engineering import add_speed_features, compute_brake_intensity
from src.analytics.era_analysis import compute_driver_stats

def test_clean_lap_data():
    df = pd.DataFrame({
        'Driver': ['VER', 'HAM', 'LEC'],
        'LapTime': [pd.Timedelta(seconds=80), pd.NaT, pd.Timedelta(seconds=81)]
    })
    cleaned = clean_lap_data(df)
    assert len(cleaned) == 2
    assert 'HAM' not in cleaned['Driver'].values

def test_normalize_lap_times():
    df = pd.DataFrame({
        'LapTime': [pd.Timedelta(seconds=80.5), pd.Timedelta(seconds=81.2)]
    })
    normalized = normalize_lap_times(df)
    assert 'LapTimeSeconds' in normalized.columns
    assert normalized['LapTimeSeconds'].iloc[0] == 80.5

def test_speed_features():
    df = pd.DataFrame({
        'Speed': [100.0, 150.0, 200.0],
        'Brake': [0.0, 0.5, 1.0]
    })
    df_feat = add_speed_features(df)
    assert 'acceleration' in df_feat.columns
    df_brake = compute_brake_intensity(df)
    assert 'brake_intensity' in df_brake.columns
    assert df_brake['brake_intensity'].iloc[2] == 200.0

def test_compute_driver_stats():
    df = pd.DataFrame({
        'driver': ['VER', 'VER', 'LEC', 'LEC'],
        'points': [25, 25, 18, 15],
        'position': [1, 1, 2, 3]
    })
    stats = compute_driver_stats(df)
    assert stats.iloc[0]['driver'] == 'VER'
    assert stats.iloc[0]['points'] == 50
    assert stats.iloc[0]['position'] == 1.0
