"""
Pydantic models for hospital-related requests and responses.

These define the exact shape of data your API accepts and returns.
FastAPI uses them to:
  - Validate incoming requests (reject bad data automatically)
  - Generate Swagger docs (so you can test endpoints in the browser)
  - Serialize responses (convert Python objects to JSON)
"""

from typing import Literal, Optional
from datetime import datetime
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Shared / nested models
# ---------------------------------------------------------------------------

class BedStatus(BaseModel):
    """Bed availability for a single bed type at a hospital."""
    available: int = 0
    overflow: int = 0
    tier: str = "official"  # official, overflow, full


class BedUpdate(BaseModel):
    """Single bed type update — used when a hospital reports new counts."""
    bed_type: str               # icu, ward, maternity, etc.
    available_count: int = Field(ge=0)
    overflow_count: int = Field(ge=0, default=0)


# ---------------------------------------------------------------------------
# Search request/response
# ---------------------------------------------------------------------------

class NearbySearchRequest(BaseModel):
    """POST /api/search/nearby — find hospitals near a location."""
    latitude: float = Field(description="User's latitude")
    longitude: float = Field(description="User's longitude")
    radius_km: float = Field(default=15, le=50, description="Search radius in km")
    bed_type: Optional[str] = Field(default=None, description="Filter by bed type, e.g. 'icu'")
    include_overflow: bool = Field(default=True, description="Include overflow-tier results")
    limit: int = Field(default=5, ge=1, le=10)


class HospitalSearchResult(BaseModel):
    """Single hospital in search results."""
    hospital_id: str
    name: str
    distance_km: float
    address: str
    phone: Optional[str] = None
    trust_tier: str
    beds: dict[str, BedStatus]       # keyed by bed_type
    equipment: list[str]
    last_report_at: Optional[datetime]
    freshness_hours: Optional[float]
    composite_score: float


class NearbySearchResponse(BaseModel):
    """Response from POST /api/search/nearby."""
    results: list[HospitalSearchResult]
    query_id: str
    searched_at: datetime


# ---------------------------------------------------------------------------
# Triage request/response
# ---------------------------------------------------------------------------

class TriageSearchRequest(BaseModel):
    """POST /api/search/triage — natural language emergency search."""
    description: str = Field(description="Natural language emergency description")
    latitude: float
    longitude: float
    radius_km: float = Field(default=20, le=50)


class ParsedRequirements(BaseModel):
    """What Claude extracted from the emergency description."""
    urgency: str                          # critical, high, medium, low
    required_beds: list[str]
    required_equipment: list[str]
    required_specialists: list[str]
    condition_category: str
    self_care_advice: list[str] = []


class TriageSearchResponse(BaseModel):
    """Response from POST /api/search/triage."""
    parsed_requirements: ParsedRequirements
    results: list[HospitalSearchResult]
    query_id: str


class TriageChatMessage(BaseModel):
    """Single chat bubble in the conversational triage flow."""
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=1000)


class TriageChatRequest(BaseModel):
    """POST /api/search/chat — multi-turn triage chat for web booking."""
    messages: list[TriageChatMessage] = Field(min_length=1, max_length=20)
    latitude: float
    longitude: float
    radius_km: float = Field(default=20, le=50)


class TriageChatResponse(BaseModel):
    """Assistant response for one conversational triage turn."""
    assistant_message: str
    should_search: bool
    parsed_requirements: Optional[ParsedRequirements] = None
    results: list[HospitalSearchResult] = []
    query_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Hospital data endpoints
# ---------------------------------------------------------------------------

class HospitalSummary(BaseModel):
    """Hospital in list view (GET /api/hospitals)."""
    id: str
    name: str
    lat: float
    lng: float
    trust_tier: str
    accuracy_score: float
    last_report_at: Optional[datetime]
    beds: list[dict]                      # raw bed records
    equipment: list[str]


class HospitalListResponse(BaseModel):
    """Response from GET /api/hospitals."""
    hospitals: list[HospitalSummary]


class BedReportRequest(BaseModel):
    """POST /api/hospitals/{id}/beds — manual bed update from web dashboard."""
    beds: list[BedUpdate]
    reported_by: str = Field(default="Web Dashboard")
