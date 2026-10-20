"""
drivers.py — Driver endpoints and routes router.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/drivers", tags=["drivers"])
