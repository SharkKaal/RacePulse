"""
strategy_model.py — Tyre strategy and pit window modeling for RacePulse.
"""

from typing import Any


def estimate_pit_window(total_laps: int, target_stops: int = 1) -> list[dict[str, Any]]:
    """
    Estimate nominal pit stop windows for a race.
    """
    if total_laps <= 0 or target_stops <= 0:
        return []

    stint_length = total_laps / (target_stops + 1)
    windows = []
    for stop_idx in range(1, target_stops + 1):
        target_lap = int(round(stop_idx * stint_length))
        windows.append({
            "stop_number": stop_idx,
            "window_open": max(1, target_lap - 2),
            "target_lap": target_lap,
            "window_close": min(total_laps, target_lap + 2),
        })
    return windows
