"""
Search engine — the core of BedSignal.

Constructs PostGIS queries to find hospitals near a location,
filters by bed availability and equipment, and ranks results
by a composite score of distance + accuracy + freshness.

Usage:
    from app.services.search_engine import search_nearby

    results, query_id = await search_nearby(
        lat=6.5244, lng=3.3792, radius_km=15
    )
"""

import hashlib
from datetime import datetime, timezone
from app.database import supabase


# ---------------------------------------------------------------------------
# Equipment flags — maps the boolean columns on hospitals table to
# the string names used in search results and triage matching.
# ---------------------------------------------------------------------------
EQUIPMENT_FLAGS = [
    "has_icu", "has_theatre", "has_blood_bank", "has_ct_scanner",
    "has_mri", "has_ventilators", "has_dialysis", "has_oxygen",
    "has_xray", "has_ultrasound", "has_pharmacy", "has_lab", "has_ambulance",
]

def extract_equipment(hospital: dict) -> list[str]:
    """Turn boolean flags into a list like ['ct_scanner', 'blood_bank', ...]."""
    equipment = []
    for flag in EQUIPMENT_FLAGS:
        if hospital.get(flag, False):
            # Strip 'has_' prefix: has_ct_scanner → ct_scanner
            equipment.append(flag[4:])
    return equipment


# ---------------------------------------------------------------------------
# Core search
# ---------------------------------------------------------------------------

async def search_nearby(
    lat: float,
    lng: float,
    radius_km: float = 15,
    bed_type: str | None = None,
    include_overflow: bool = True,
    limit: int = 5,
    required_equipment: list[str] | None = None,
    user_phone: str | None = None,
    query_type: str = "basic_search",
    query_text: str | None = None,
    channel: str = "web",
) -> tuple[list[dict], str]:
    """
    Find hospitals near a location with available beds.

    Returns:
        (results, query_id) — list of ranked hospital dicts and the logged query ID.
    """

    radius_m = radius_km * 1000

    # ── Step 1: Find hospitals within radius using PostGIS ─────────
    #
    # Supabase's Python client doesn't support raw PostGIS SQL directly,
    # so we use an RPC call to a database function. But for the hackathon,
    # we'll use the .rpc() method with a raw SQL function.
    #
    # First, let's create the query using Supabase's REST API.
    # We fetch all active hospitals, then filter/rank in Python.
    # This works fine for 30 hospitals. For thousands, you'd push
    # the PostGIS query into a database function.
    # ────────────────────────────────────────────────────────────────

    # Fetch all active hospitals with their beds
    hospitals_resp = (
        supabase.table("hospitals")
        .select("*")
        .eq("is_active", True)
        .execute()
    )
    hospitals = hospitals_resp.data

    beds_resp = (
        supabase.table("hospital_beds")
        .select("*")
        .execute()
    )
    all_beds = beds_resp.data

    # Group beds by hospital_id
    beds_by_hospital: dict[str, list[dict]] = {}
    for bed in all_beds:
        hid = bed["hospital_id"]
        if hid not in beds_by_hospital:
            beds_by_hospital[hid] = []
        beds_by_hospital[hid].append(bed)

    # ── Step 2: Calculate distance and filter ──────────────────────
    now = datetime.now(timezone.utc)
    candidates = []

    for h in hospitals:
        # Parse location from PostGIS geography
        # Supabase returns geography as a string or object depending on config.
        # We need to extract lat/lng. The location is stored as POINT(lng lat).
        h_lat, h_lng = _parse_location(h.get("location"))
        if h_lat is None:
            continue

        # Calculate distance using Haversine (good enough for <50km)
        dist_km = _haversine(lat, lng, h_lat, h_lng)

        # Filter by radius
        if dist_km > radius_km:
            continue

        # Get this hospital's beds
        hospital_beds = beds_by_hospital.get(h["id"], [])

        # Filter by bed availability
        has_available = False
        beds_summary = {}

        for bed in hospital_beds:
            bt = bed["bed_type"]

            # If specific bed_type requested, skip others
            if bed_type and bt != bed_type:
                continue

            avail = bed["available_count"] or 0
            overflow = bed["overflow_count"] or 0

            if avail > 0:
                has_available = True
            elif include_overflow and overflow > 0:
                has_available = True

            if avail > 0 or (include_overflow and overflow > 0):
                beds_summary[bt] = {
                    "available": avail,
                    "overflow": overflow,
                    "tier": bed["capacity_tier"],
                }

        if not has_available:
            continue

        # Filter by required equipment (for triage searches)
        if required_equipment:
            equipment = extract_equipment(h)
            # Check if hospital has all required equipment
            missing = [eq for eq in required_equipment if eq not in equipment]
            if missing:
                # Still include but penalize in scoring
                equipment_match = 1 - (len(missing) / len(required_equipment))
            else:
                equipment_match = 1.0
        else:
            equipment_match = 1.0

        # ── Step 3: Calculate composite score ──────────────────────
        #
        # Same formula from the PRD Section 3.2:
        #   distance_score * 0.3 + accuracy * 0.2 + freshness * 0.3 + equipment * 0.2
        #
        # distance_score: 1.0 when right next door, 0.0 at the edge of radius
        # accuracy_score: 0.0 to 1.0 from Ghost Bed Detection
        # freshness: 0.3 if <4hr, 0.15 if <8hr, 0.0 otherwise
        # equipment_match: 1.0 if all required equipment present
        # ───────────────────────────────────────────────────────────

        distance_score = max(0, 1 - (dist_km / radius_km))
        accuracy = h.get("accuracy_score", 0.5)

        # Freshness based on last report
        last_report = h.get("last_report_at")
        if last_report:
            if isinstance(last_report, str):
                try:
                    last_report = datetime.fromisoformat(last_report.replace("Z", "+00:00"))
                except ValueError:
                    last_report = None

        if last_report:
            hours_since = (now - last_report).total_seconds() / 3600
            if hours_since < 4:
                freshness_component = 0.30
            elif hours_since < 8:
                freshness_component = 0.15
            else:
                freshness_component = 0.0
        else:
            hours_since = None
            freshness_component = 0.0

        composite = (
            distance_score * 0.30
            + accuracy * 0.20
            + freshness_component
            + equipment_match * 0.20
        )

        candidates.append({
            "hospital_id": h["id"],
            "name": h["name"],
            "distance_km": round(dist_km, 1),
            "address": h["address"],
            "trust_tier": h.get("trust_tier", "active"),
            "beds": beds_summary,
            "equipment": extract_equipment(h),
            "last_report_at": h.get("last_report_at"),
            "freshness_hours": round(hours_since, 1) if hours_since is not None else None,
            "composite_score": round(composite, 3),
        })

    # ── Step 4: Sort by composite score and limit ──────────────────
    candidates.sort(key=lambda x: x["composite_score"], reverse=True)
    results = candidates[:limit]

    # ── Step 5: Log the query ──────────────────────────────────────
    phone_hash = None
    if user_phone:
        phone_hash = hashlib.sha256(user_phone.encode()).hexdigest()

    query_row = {
        "query_text": query_text,
        "query_type": query_type,
        "channel": channel,
        "user_phone_hash": phone_hash,
        "results_returned": [{"hospital_id": r["hospital_id"], "rank": i + 1, "score": r["composite_score"]} for i, r in enumerate(results)],
        "followup_sent": False,
    }

    query_resp = supabase.table("queries").insert(query_row).execute()
    query_id = query_resp.data[0]["id"]

    return results, query_id


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_location(location) -> tuple[float | None, float | None]:
    import shapely.wkb
    import binascii
    """
    Extract lat/lng from Supabase geography column.

    Supabase returns PostGIS geography in different formats depending
    on how you query. Common formats:
      - String: "POINT(3.3792 6.5244)" — lng first, then lat
      - Dict with coordinates
    """
    if location is None:
        return None, None
    
    # Handle WKB hex format (Supabase PostGIS output)
    if isinstance(location, str) and location.startswith("0101"):
        try:
            geom = shapely.wkb.loads(binascii.unhexlify(location))
            return geom.y, geom.x
        except Exception:
            return None, None

    if isinstance(location, str):
        # Parse "POINT(lng lat)" or "SRID=4326;POINT(lng lat)"
        try:
            # Strip SRID prefix if present
            point_str = location
            if "POINT" in point_str:
                coords = point_str.split("POINT")[1].strip("() ")
                parts = coords.split()
                lng = float(parts[0])
                lat = float(parts[1])
                return lat, lng
        except (IndexError, ValueError):
            return None, None

    # GeoJSON parser
    if isinstance(location, dict):
        coords = location.get("coordinates")
        if coords and len(coords) >= 2:
            return coords[1], coords[0]

    return None, None


def _haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """
    Calculate distance between two points in km using the Haversine formula.

    Accurate enough for distances under 50km (our max search radius).
    """
    import math

    R = 6371  # Earth's radius in km

    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)

    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlng / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return R * c
