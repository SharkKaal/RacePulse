import pytest
from unittest.mock import patch, MagicMock
import pandas as pd
from fastapi.testclient import TestClient
from src.api.app import app

client = TestClient(app)

def test_home_endpoint():
    response = client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers.get("content-type", "")

def test_session_info_endpoint():
    with patch("src.api.app.get_session_info") as mock_info:
        mock_info.return_value = ({
            "event_name": "Monaco Grand Prix",
            "country": "Monaco",
            "location": "Monte Carlo",
            "circuit": "Circuit de Monaco",
            "round": 8,
            "date": "2024-05-26",
            "session_type": "R",
            "year": 2024,
            "total_laps": 78
        }, None)
        response = client.get("/api/session-info?year=2024&race=Monaco&session_type=R")
        assert response.status_code == 200
        data = response.json()
        assert data["event_name"] == "Monaco Grand Prix"
        assert data["total_laps"] == 78

def test_race_results_endpoint():
    with patch("src.api.app.load_session") as mock_load, \
         patch("src.api.app.get_race_results") as mock_res, \
         patch("src.api.app.get_dnfs") as mock_dnfs:
        mock_load.return_value = MagicMock()
        mock_res.return_value = [{"position": 1, "driver_code": "LEC", "points": 25.0}]
        mock_dnfs.return_value = []
        
        response = client.get("/api/results?year=2024&race=Monaco&session_type=R")
        assert response.status_code == 200
        data = response.json()
        assert "results" in data
        assert len(data["results"]) == 1
        assert data["results"][0]["driver_code"] == "LEC"

def test_speed_traps_endpoint():
    with patch("src.api.app.load_session") as mock_load, \
         patch("src.api.app.get_speed_trap_data") as mock_traps:
        mock_load.return_value = MagicMock()
        mock_traps.return_value = [{"driver": "VER", "max_speed_st": 315.4}]
        
        response = client.get("/api/speed-traps?year=2024&race=Monaco&session_type=R")
        assert response.status_code == 200
        data = response.json()
        assert "speed_traps" in data
        assert data["speed_traps"][0]["driver"] == "VER"

def test_pit_stops_endpoint():
    with patch("src.api.app.load_session") as mock_load, \
         patch("src.api.app.get_pit_stop_data") as mock_pits:
        mock_load.return_value = MagicMock()
        mock_pits.return_value = [{"driver": "LEC", "stop": 1, "lap": 24, "duration": 22.4}]
        
        response = client.get("/api/pit-stops?year=2024&race=Monaco&session_type=R")
        assert response.status_code == 200
        data = response.json()
        assert "pit_stops" in data
        assert data["pit_stops"][0]["duration"] == 22.4

def test_compare_endpoint_success():
    with patch("src.api.app.load_session") as mock_load:
        mock_session = MagicMock()
        mock_load.return_value = mock_session
        
        # Telemetry mock
        mock_tel = pd.DataFrame({
            "Distance": [0.0, 100.0, 200.0, 300.0],
            "Speed": [100.0, 150.0, 200.0, 250.0],
            "Throttle": [50.0, 100.0, 100.0, 80.0],
            "Brake": [0.0, 0.0, 0.0, 1.0],
            "nGear": [3, 4, 5, 4],
            "RPM": [9000, 11000, 12000, 10000],
            "DRS": [0, 1, 1, 0]
        })
        mock_pos = pd.DataFrame({
            "X": [10.0, 20.0, 30.0, 40.0],
            "Y": [15.0, 25.0, 35.0, 45.0],
            "Z": [0.0, 0.0, 0.0, 0.0]
        })

        mock_lap1 = MagicMock()
        mock_lap1.get_telemetry.return_value = mock_tel
        mock_lap1.get_pos_data.return_value = mock_pos

        mock_lap2 = MagicMock()
        mock_lap2.get_telemetry.return_value = mock_tel
        mock_lap2.get_pos_data.return_value = mock_pos

        mock_laps_obj = MagicMock()
        mock_laps_obj.empty = False
        mock_laps_obj.pick_fastest.side_effect = [mock_lap1, mock_lap2]
        mock_session.laps.pick_drivers.return_value = mock_laps_obj
        mock_session.results = pd.DataFrame({
            "Abbreviation": ["VER", "LEC"],
            "TeamName": ["Red Bull Racing", "Ferrari"],
            "TeamColor": ["3671C6", "E80020"]
        })

        response = client.get("/compare?year=2024&race=Monaco&driver1=VER&driver2=LEC")
        assert response.status_code == 200
        data = response.json()
        assert "speed1" in data
        assert "speed2" in data
        assert "delta" in data
        assert data["driver1"] == "VER"
        assert data["driver2"] == "LEC"

def test_compare_endpoint_missing_driver_returns_404():
    with patch("src.api.app.load_session") as mock_load:
        mock_session = MagicMock()
        mock_session.laps.empty = False
        mock_session.laps.pick_drivers.return_value = pd.DataFrame()  # Empty
        mock_session.laps.__contains__.return_value = False
        mock_session.laps.columns = []
        mock_load.return_value = mock_session

        response = client.get("/compare?year=2024&race=Monaco&driver1=NONEXISTENT&driver2=LEC")
        assert response.status_code == 404
        assert "No lap data found for driver" in response.json()["detail"]

def test_3d_track_endpoint():
    with patch("src.api.app.load_session") as mock_load:
        mock_session = MagicMock()
        mock_lap = MagicMock()
        mock_lap.get_pos_data.return_value = pd.DataFrame({
            "X": [1.0, 2.0, 3.0],
            "Y": [4.0, 5.0, 6.0],
            "Z": [0.1, 0.2, 0.3]
        })
        mock_session.laps.pick_fastest.return_value = mock_lap
        mock_load.return_value = mock_session

        response = client.get("/track/3d?year=2024&race=Monaco&session_type=R")
        assert response.status_code == 200
        data = response.json()
        assert data["x"] == [1.0, 2.0, 3.0]
        assert data["y"] == [4.0, 5.0, 6.0]
        assert data["z"] == [0.1, 0.2, 0.3]
