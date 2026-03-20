"""
Hospital onboarding endpoint.

POST /api/hospitals/onboard — register a new hospital on the BedSignal network.

This is the only moment in the hospital journey that happens outside WhatsApp.
After registration, the hospital receives a WhatsApp welcome message and
can start reporting via STATUS, UPDATE, and DISCHARGE keywords.
"""

from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
from app.database import supabase
from app.services.whatsapp import send_text
import re

router = APIRouter(prefix="/hospitals", tags=["Onboarding"])


# ---------------------------------------------------------------------------
# LGA coordinate lookup (hackathon geocoding)
# ---------------------------------------------------------------------------
LGA_COORDINATES = {
    "ikeja": (6.6018, 3.3515),
    "surulere": (6.5059, 3.3498),
    "lagos island": (6.4541, 3.4075),
    "eti-osa": (6.4281, 3.4219),
    "mushin": (6.5375, 3.3530),
    "kosofe": (6.5780, 3.4100),
    "alimosho": (6.6117, 3.2590),
    "agege": (6.6200, 3.3300),
    "amuwo-odofin": (6.4640, 3.3570),
    "oshodi-isolo": (6.5560, 3.3210),
    "ikorodu": (6.6194, 3.5105),
    "epe": (6.5833, 3.9833),
    "badagry": (6.4150, 2.8814),
    "apapa": (6.4488, 3.3590),
    "somolu": (6.5380, 3.3820),
    "ifako-ijaiye": (6.6310, 3.3190),
    "ojo": (6.4684, 3.1822),
    "ajeromi-ifelodun": (6.4580, 3.3340),
    "mainland": (6.4969, 3.3630),
}


# ---------------------------------------------------------------------------
# Request model
# ---------------------------------------------------------------------------

class OnboardRequest(BaseModel):
    hospital_name: str = Field(min_length=2, max_length=255)
    address: str = Field(min_length=5)
    lga: str
    hospital_type: str = Field(description="general, teaching, specialist, private, maternity, clinic")
    bed_types: list[dict] = Field(
        description="List of {bed_type, total_count}",
        min_length=1,
    )
    equipment: list[str] = Field(default=[])
    whatsapp_number: str = Field(min_length=10)
    phone: Optional[str] = None
    email: Optional[str] = None
    contact_person: Optional[str] = None


# ---------------------------------------------------------------------------
# POST /api/hospitals/onboard
# ---------------------------------------------------------------------------

@router.post("/onboard")
async def onboard_hospital(request: OnboardRequest):
    """Register a new hospital on the BedSignal network."""

    # Validate hospital type
    valid_types = {"general", "teaching", "specialist", "private", "maternity", "clinic"}
    if request.hospital_type.lower() not in valid_types:
        raise HTTPException(status_code=400, detail=f"Invalid hospital type. Must be one of: {', '.join(valid_types)}")

    # Validate bed types
    valid_bed_types = {"icu", "ward", "maternity", "emergency", "pediatric", "surgical", "psychiatric"}
    for bt in request.bed_types:
        if bt.get("bed_type", "").lower() not in valid_bed_types:
            raise HTTPException(status_code=400, detail=f"Invalid bed type: {bt.get('bed_type')}. Must be one of: {', '.join(valid_bed_types)}")

    # Clean WhatsApp number
    wa_number = request.whatsapp_number.strip()
    if not wa_number.startswith("+"):
        wa_number = f"+{wa_number}"

    # Check uniqueness
    existing = (
        supabase.table("hospitals")
        .select("id")
        .eq("whatsapp_number", wa_number)
        .execute()
    )
    if existing.data:
        raise HTTPException(status_code=409, detail="This WhatsApp number is already registered on BedSignal.")

    # Generate slug
    slug = re.sub(r"[^a-z0-9]+", "-", request.hospital_name.lower()).strip("-")
    # Ensure uniqueness
    slug_check = supabase.table("hospitals").select("id").eq("slug", slug).execute()
    if slug_check.data:
        slug = f"{slug}-{datetime.now().strftime('%H%M%S')}"

    # Geocode from LGA
    lga_lower = request.lga.lower().strip()
    lat, lng = LGA_COORDINATES.get(lga_lower, (6.5244, 3.3792))  # Default to Lagos center

    # Build equipment flags
    equipment_set = set(eq.lower().replace(" ", "_") for eq in request.equipment)
    equipment_flags = {
        "has_icu": "icu" in [bt["bed_type"].lower() for bt in request.bed_types],
        "has_theatre": "theatre" in equipment_set,
        "has_blood_bank": "blood_bank" in equipment_set,
        "has_ct_scanner": "ct_scanner" in equipment_set,
        "has_mri": "mri" in equipment_set,
        "has_ventilators": "ventilators" in equipment_set,
        "has_dialysis": "dialysis" in equipment_set,
        "has_oxygen": "oxygen" in equipment_set,
        "has_xray": "xray" in equipment_set or "x_ray" in equipment_set,
        "has_ultrasound": "ultrasound" in equipment_set,
        "has_pharmacy": "pharmacy" in equipment_set,
        "has_lab": "lab" in equipment_set,
        "has_ambulance": "ambulance" in equipment_set,
    }

    # Calculate total beds
    total_beds = sum(bt.get("total_count", 0) for bt in request.bed_types)

    now = datetime.now(timezone.utc).isoformat()

    # Insert hospital
    hospital_row = {
        "name": request.hospital_name.strip(),
        "slug": slug,
        "location": f"POINT({lng} {lat})",
        "address": request.address.strip(),
        "lga": request.lga.strip(),
        "city": "Lagos",
        "phone": request.phone,
        "whatsapp_number": wa_number,
        "email": request.email,
        "hospital_type": request.hospital_type.lower(),
        **equipment_flags,
        "trust_tier": "active",
        "accuracy_score": 0.5,
        "freshness_score": 1.0,
        "total_beds": total_beds,
        "is_active": True,
        "onboarded_at": now,
        "last_report_at": now,
    }

    result = supabase.table("hospitals").insert(hospital_row).execute()
    hospital_id = result.data[0]["id"]

    # Insert bed types
    for bt in request.bed_types:
        bed_type = bt["bed_type"].lower()
        total_count = bt.get("total_count", 0)

        supabase.table("hospital_beds").insert({
            "hospital_id": hospital_id,
            "bed_type": bed_type,
            "total_count": total_count,
            "available_count": total_count,  # Start fully available
            "overflow_count": 0,
            "reported_by": "Onboarding",
            "reported_at": now,
        }).execute()

    # Send WhatsApp welcome message
    await send_text(wa_number, (
        f"Welcome to BedSignal, *{request.hospital_name.strip()}*! 🏥\n\n"
        f"You're now live on the network. Here's how it works:\n\n"
        f"*STATUS* — View your current recorded data\n"
        f"*UPDATE* — Start an interactive bed update\n"
        f"*DISCHARGE 2 ICU* — Record patient discharges\n\n"
        f"We'll check in every 6 hours to keep your data fresh.\n"
        f"Questions? Reply anytime."
    ))

    print(f"🏥 ONBOARDED: {request.hospital_name} ({slug}) — {len(request.bed_types)} bed types, {total_beds} total beds")

    # Patient log URL
    log_url = f"/log/{slug}"

    return {
        "status": "success",
        "hospital_id": hospital_id,
        "slug": slug,
        "log_url": log_url,
        "message": f"{request.hospital_name} is now live on BedSignal!",
        "whatsapp_instructions": "You'll receive a WhatsApp message shortly with instructions.",
    }
