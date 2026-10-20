"""
races.py — Race endpoints and routes router.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/races", tags=["races"])
