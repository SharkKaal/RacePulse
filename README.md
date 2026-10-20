# RacePulse — F1 Telemetry & Analytics Platform

RacePulse is a Formula 1 data analytics and visualization platform built with **FastF1**, **FastAPI**, **Pandas**, and **Matplotlib**.

---

## 🏎️ Features

- **Fastest Lap Telemetry Comparison**: Side-by-side speed, delta time, throttle, and brake analysis between drivers.
- **Race Replay & Strategy Insights**: Tyre stints, pit stops, degradation analysis, and speed trap stats.
- **Interactive Web Dashboard**: Full UI served directly from FastAPI (`frontend/dashboard/index.html`).

---

## 🚀 How to Run

Ensure your virtual environment is active, or use `.\.venv\Scripts\python.exe`.

### 1. Run the Telemetry Comparison Script (Matplotlib GUI)
Runs the standalone comparison between Max Verstappen (`VER`) and Charles Leclerc (`LEC`) for the Monaco 2024 Grand Prix:

```bash
.\.venv\Scripts\python.exe main.py
```

### 2. Run the Interactive Web Dashboard (FastAPI Server)
Launches the web application with live REST API and interactive telemetry dashboard:

```bash
.\.venv\Scripts\python.exe -m uvicorn src.api.app:app --reload --port 8000
```
Then open your browser and navigate to: **[http://127.0.0.1:8000](http://127.0.0.1:8000)**

### 3. Run Unit Tests
Run the test suite with `pytest`:

```bash
.\.venv\Scripts\python.exe -m pytest
```

> **Note for Windows users**: Because the project path may contain spaces, invoke tools via `python -m <module>` (e.g. `python -m pytest` or `python -m uvicorn`) rather than the trampoline `.exe` files in `Scripts/`.
