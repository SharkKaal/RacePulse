"""
lap_time_model.py — Lap time modeling and estimation utilities for RacePulse.
"""

import numpy as np
import pandas as pd


def estimate_lap_time(sector1: float, sector2: float, sector3: float) -> float:
    """Estimate total lap time from sector times."""
    return round(float(sector1 + sector2 + sector3), 3)


def predict_optimal_lap(lap_times: list[float]) -> float | None:
    """Return theoretical optimal lap based on minimal sector/lap variations."""
    valid_times = [t for t in lap_times if t is not None and not np.isnan(t)]
    if not valid_times:
        return None
    return round(float(min(valid_times)), 3)
