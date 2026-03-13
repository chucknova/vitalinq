"""
Pydantic models for search query logging and the Dispatch Command overview.

The queries table logs every search. The dispatch overview combines
hospitals, active handshakes, and surge predictions into one payload.
"""

from pydantic import BaseModel
from typing import Optional
from datetime import datetime


# ---------------------------------------------------------------------------
# Query log (mostly internal — used by Ghost Bed Detection)
# ---------------------------------------------------------------------------

class QueryLog(BaseModel):
    """A logged search query."""
    id: str
    query_text: Optional[str]
    query_type: str              # panic_mode, triage, basic_search, web
    channel: str                 # whatsapp, sms, web
    selected_hospital_id: Optional[str]
    followup_sent: bool
    created_at: datetime


# ---------------------------------------------------------------------------
# Dispatch Command overview
# ---------------------------------------------------------------------------

class ActiveHandshake(BaseModel):
    """An in-progress bed reservation shown on the dispatch dashboard."""
    id: str
    status: str
    from_location: Optional[dict]   # {"lat": float, "lng": float}
    to_hospital: dict               # {"id": str, "name": str, "lat": float, "lng": float}
    time_remaining_sec: Optional[int]


class SurgePrediction(BaseModel):
    """A single capacity forecast data point."""
    hospital_id: str
    hour: int
    predicted_occupancy_pct: float
    bed_type: str


class DispatchOverviewResponse(BaseModel):
    """Response from GET /api/dispatch/overview — everything the dispatcher needs."""
    hospitals: list[dict]                   # full hospital list with beds
    active_handshakes: list[ActiveHandshake]
    predictions: list[SurgePrediction]
