"""
telemetry.py — Telemetry endpoints and routes router.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/telemetry", tags=["telemetry"])
