"""
Search endpoints — the heart of BedSignal.

POST /api/search/nearby  — proximity search with composite ranking
POST /api/search/triage  — natural language → Claude → enriched search (Phase 5)
"""

from datetime import datetime, timezone
from fastapi import APIRouter
from app.models.hospital import (
    NearbySearchRequest,
    NearbySearchResponse,
    HospitalSearchResult,
    BedStatus,
)
from app.services.search_engine import search_nearby

router = APIRouter(prefix="/search", tags=["Search"])


# ---------------------------------------------------------------------------
# POST /api/search/nearby
# ---------------------------------------------------------------------------

@router.post("/nearby", response_model=NearbySearchResponse)
async def nearby_search(request: NearbySearchRequest):
    """
    Find hospitals near a location with available beds.

    This powers:
      - Panic Mode (WhatsApp EMERGENCY flow)
      - Basic web search on the Pulse Map
      - Dispatch Command one-click search
    """

    results, query_id = await search_nearby(
        lat=request.latitude,
        lng=request.longitude,
        radius_km=request.radius_km,
        bed_type=request.bed_type,
        include_overflow=request.include_overflow,
        limit=request.limit,
        query_type="basic_search",
        channel="web",
    )

    # Convert raw dicts to response models
    hospital_results = []
    for r in results:
        beds = {}
        for bed_type, bed_data in r["beds"].items():
            beds[bed_type] = BedStatus(
                available=bed_data["available"],
                overflow=bed_data["overflow"],
                tier=bed_data["tier"],
            )

        hospital_results.append(HospitalSearchResult(
            hospital_id=r["hospital_id"],
            name=r["name"],
            distance_km=r["distance_km"],
            address=r["address"],
            trust_tier=r["trust_tier"],
            beds=beds,
            equipment=r["equipment"],
            last_report_at=r["last_report_at"],
            freshness_hours=r["freshness_hours"],
            composite_score=r["composite_score"],
        ))

    return NearbySearchResponse(
        results=hospital_results,
        query_id=query_id,
        searched_at=datetime.now(timezone.utc),
    )


# ---------------------------------------------------------------------------
# POST /api/search/triage — will be added in Phase 5
# ---------------------------------------------------------------------------
# @router.post("/triage", response_model=TriageSearchResponse)
# async def triage_search(request: TriageSearchRequest):
#     ...
