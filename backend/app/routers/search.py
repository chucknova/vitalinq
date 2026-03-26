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
    TriageChatRequest,
    TriageChatResponse,
    TriageSearchRequest,
    TriageSearchResponse,
    ParsedRequirements,
    HospitalSearchResult,
    BedStatus,
)
from app.services.search_engine import search_nearby
from app.services.triage_chat import run_triage_chat
from app.services.triage import parse_emergency

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
# POST /api/search/triage
# ---------------------------------------------------------------------------

@router.post("/triage", response_model=TriageSearchResponse)
async def triage_search(request: TriageSearchRequest):
    """
    Smart Triage Router — natural language emergency → enriched search.

    1. Sends description to Claude → gets structured requirements
    2. Runs hospital search filtered by required equipment and bed types
    3. Returns ranked results with the parsed requirements

    This powers:
      - WhatsApp Smart Triage flow (default route for natural language)
      - Web-based triage search
    """

    # Step 1: Parse emergency with Claude
    parsed = await parse_emergency(request.description)

    # Step 2: Run enriched search
    results, query_id = await search_nearby(
        lat=request.latitude,
        lng=request.longitude,
        radius_km=request.radius_km,
        bed_type=parsed["required_beds"][0] if parsed["required_beds"] else None,
        include_overflow=True,
        limit=5,
        required_equipment=parsed["required_equipment"],
        query_type="triage",
        query_text=request.description,
        channel="web",
    )

    # Step 3: Format response
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

    return TriageSearchResponse(
        parsed_requirements=ParsedRequirements(**parsed),
        results=hospital_results,
        query_id=query_id,
    )


@router.post("/chat", response_model=TriageChatResponse)
async def triage_chat(request: TriageChatRequest):
    """
    Conversational triage for the web booking flow.

    Accepts the full chat history, decides whether to ask one clarifying
    question or run a hospital search, and returns the next assistant turn.
    """

    payload = await run_triage_chat(
        messages=[msg.model_dump() for msg in request.messages],
        latitude=request.latitude,
        longitude=request.longitude,
        radius_km=request.radius_km,
    )

    hospital_results = []
    for r in payload["results"]:
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

    return TriageChatResponse(
        assistant_message=payload["assistant_message"],
        should_search=payload["should_search"],
        parsed_requirements=ParsedRequirements(**payload["parsed_requirements"])
        if payload["parsed_requirements"]
        else None,
        results=hospital_results,
        query_id=payload["query_id"],
    )
