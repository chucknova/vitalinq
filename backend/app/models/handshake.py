"""
Pydantic models for the Handshake (bed reservation) system.

The handshake lifecycle:
    requested → accepted | declined → completed | expired
"""

from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


# ---------------------------------------------------------------------------
# Create handshake
# ---------------------------------------------------------------------------

class HandshakeCreateRequest(BaseModel):
    """POST /api/handshakes — request a bed reservation."""
    receiving_hospital_id: str
    bed_type: str
    requesting_party_type: str = Field(description="ambulance, hospital, or individual")
    requesting_party_phone: str
    patient_summary: Optional[str] = None
    parsed_requirements: Optional[dict] = None
    query_id: Optional[str] = None
    hold_duration_min: int = Field(default=45, ge=15, le=120)


class HandshakeCreateResponse(BaseModel):
    """Response from POST /api/handshakes."""
    handshake_id: str
    transfer_code: str
    status: str
    receiving_hospital: str     # hospital name
    message: str


# ---------------------------------------------------------------------------
# Get handshake status
# ---------------------------------------------------------------------------

class HospitalBrief(BaseModel):
    """Minimal hospital info embedded in handshake response."""
    name: str
    address: str


class HandshakeStatusResponse(BaseModel):
    """Response from GET /api/handshakes/{id}."""
    id: str
    status: str                             # requested, accepted, declined, expired, completed
    transfer_code: str
    receiving_hospital: HospitalBrief
    bed_type: str
    patient_summary: Optional[str]
    expires_at: Optional[datetime]
    time_remaining_sec: Optional[int]
    declined_reason: Optional[str] = None


# ---------------------------------------------------------------------------
# Complete handshake
# ---------------------------------------------------------------------------

class HandshakeCompleteRequest(BaseModel):
    """POST /api/handshakes/{id}/complete — patient has arrived."""
    transfer_code: str


class HandshakeCompleteResponse(BaseModel):
    """Response from POST /api/handshakes/{id}/complete."""
    status: str
    completed_at: datetime