"""
Hospital data endpoints — read hospital info and update bed counts.

GET  /api/hospitals            — list all active hospitals (Pulse Map initial load)
GET  /api/hospitals/{id}       — single hospital detail
POST /api/hospitals/{id}/beds  — manual bed update from web dashboard
"""

from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from app.database import supabase
from app.models.hospital import (
    HospitalListResponse,
    HospitalSummary,
    BedReportRequest,
)
from app.services.search_engine import extract_equipment, _parse_location

router = APIRouter(prefix="/hospitals", tags=["Hospitals"])


# ---------------------------------------------------------------------------
# GET /api/hospitals
# ---------------------------------------------------------------------------

@router.get("", response_model=HospitalListResponse)
async def list_hospitals(
    city: str = "Lagos",
    include_beds: bool = True,
):
    """
    List all active hospitals. Used by Pulse Map and Dispatch Command
    on initial page load to plot every hospital on the map.
    """

    # Fetch hospitals
    query = (
        supabase.table("hospitals")
        .select("*")
        .eq("is_active", True)
        .eq("city", city)
    )
    hospitals = query.execute().data

    # Fetch all beds in one call (cheaper than N+1 queries)
    beds_data = []
    if include_beds:
        beds_data = supabase.table("hospital_beds").select("*").execute().data

    # Group beds by hospital
    beds_by_hospital: dict[str, list[dict]] = {}
    for bed in beds_data:
        hid = bed["hospital_id"]
        if hid not in beds_by_hospital:
            beds_by_hospital[hid] = []
        beds_by_hospital[hid].append(bed)

    # Build response
    result = []
    for h in hospitals:
        lat, lng = _parse_location(h.get("location"))

        result.append(HospitalSummary(
            id=h["id"],
            name=h["name"],
            lat=lat or 0.0,
            lng=lng or 0.0,
            trust_tier=h.get("trust_tier", "active"),
            accuracy_score=h.get("accuracy_score", 0.5),
            last_report_at=h.get("last_report_at"),
            beds=beds_by_hospital.get(h["id"], []),
            equipment=extract_equipment(h),
        ))

    return HospitalListResponse(hospitals=result)


# ---------------------------------------------------------------------------
# GET /api/hospitals/{id}
# ---------------------------------------------------------------------------

@router.get("/{hospital_id}")
async def get_hospital(hospital_id: str):
    """
    Full hospital detail with bed breakdown, equipment, and
    recent verification history.
    """

    # Fetch hospital
    resp = (
        supabase.table("hospitals")
        .select("*")
        .eq("id", hospital_id)
        .execute()
    )

    if not resp.data:
        raise HTTPException(status_code=404, detail="Hospital not found")

    hospital = resp.data[0]

    # Fetch beds
    beds = (
        supabase.table("hospital_beds")
        .select("*")
        .eq("hospital_id", hospital_id)
        .execute()
    ).data

    # Fetch recent verification signals (last 30 days)
    verifications = (
        supabase.table("verification_signals")
        .select("signal_type, signal_value, created_at")
        .eq("hospital_id", hospital_id)
        .order("created_at", desc=True)
        .limit(20)
        .execute()
    ).data

    lat, lng = _parse_location(hospital.get("location"))

    return {
        "id": hospital["id"],
        "name": hospital["name"],
        "slug": hospital["slug"],
        "lat": lat,
        "lng": lng,
        "address": hospital["address"],
        "lga": hospital["lga"],
        "city": hospital["city"],
        "phone": hospital.get("phone"),
        "email": hospital.get("email"),
        "hospital_type": hospital["hospital_type"],
        "trust_tier": hospital.get("trust_tier", "active"),
        "accuracy_score": hospital.get("accuracy_score", 0.5),
        "freshness_score": hospital.get("freshness_score", 0.0),
        "total_beds": hospital.get("total_beds", 0),
        "last_report_at": hospital.get("last_report_at"),
        "equipment": extract_equipment(hospital),
        "beds": beds,
        "recent_verifications": verifications,
    }


# ---------------------------------------------------------------------------
# POST /api/hospitals/{id}/beds
# ---------------------------------------------------------------------------

@router.post("/{hospital_id}/beds")
async def update_beds(hospital_id: str, request: BedReportRequest):
    """
    Manual bed update from the web dashboard.
    Alternative to the WhatsApp reporting flow.

    Upserts each bed type — if the row exists, update it.
    If not, create it.
    """

    # Verify hospital exists
    hospital = (
        supabase.table("hospitals")
        .select("id, name")
        .eq("id", hospital_id)
        .execute()
    )

    if not hospital.data:
        raise HTTPException(status_code=404, detail="Hospital not found")

    now = datetime.now(timezone.utc).isoformat()
    updated_beds = []

    for bed in request.beds:
        # Upsert: try update first, insert if no rows affected
        existing = (
            supabase.table("hospital_beds")
            .select("id")
            .eq("hospital_id", hospital_id)
            .eq("bed_type", bed.bed_type)
            .execute()
        )

        bed_data = {
            "hospital_id": hospital_id,
            "bed_type": bed.bed_type,
            "available_count": bed.available_count,
            "overflow_count": bed.overflow_count,
            "reported_by": request.reported_by,
            "reported_at": now,
        }

        if existing.data:
            # Update existing row
            supabase.table("hospital_beds").update(bed_data).eq(
                "id", existing.data[0]["id"]
            ).execute()
        else:
            # Insert new row
            supabase.table("hospital_beds").insert(bed_data).execute()

        updated_beds.append(bed.bed_type)

    # Refresh hospital timestamps
    supabase.table("hospitals").update({
        "last_report_at": now,
        "freshness_score": 1.0,
        "updated_at": now,
    }).eq("id", hospital_id).execute()

    return {
        "status": "updated",
        "hospital": hospital.data[0]["name"],
        "updated_bed_types": updated_beds,
        "reported_by": request.reported_by,
        "reported_at": now,
    }
