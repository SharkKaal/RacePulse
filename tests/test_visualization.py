import pytest
import numpy as np
import pandas as pd
from unittest.mock import patch
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend for testing

from src.visualization.telemetry_plots import plot_speed, compare_drivers, plot_delta_time, plot_driver_inputs, plot_full_comparison
from src.visualization.track_3d import plot_track_3d

def test_telemetry_plots_execution():
    distance = np.linspace(0, 1000, 50)
    speed = np.linspace(100, 300, 50)
    throttle = np.linspace(0, 100, 50)
    brake = np.zeros(50)
    
    with patch("matplotlib.pyplot.show"):
        plot_speed(distance, speed, driver="VER")
        compare_drivers(distance, speed, "VER", distance, speed + 5, "LEC")
        plot_delta_time(distance, speed, distance, speed + 5, "VER", "LEC")
        plot_driver_inputs(distance, throttle, brake, distance, throttle, brake, "VER", "LEC")
        
        tel1 = {"Distance": distance, "Speed": speed, "Throttle": throttle, "Brake": brake}
        tel2 = {"Distance": distance, "Speed": speed + 5, "Throttle": throttle, "Brake": brake}
        plot_full_comparison(tel1, tel2, "VER", "LEC")

def test_track_3d_execution():
    df = pd.DataFrame({
        "X": [0, 10, 20],
        "Y": [0, 15, 30],
        "Speed": [100, 200, 250]
    })
    with patch("plotly.graph_objects.Figure.show"):
        plot_track_3d(df)
