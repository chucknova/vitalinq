"""
Seed script: Load 30 Lagos hospitals + bed data into Supabase.

Usage:
    cd backend
    python -m app.seed.hospitals

Prerequisites:
    - Supabase project with schema created (Phase 1)
    - .env file with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
    - lagos_hospitals.json in app/seed/data/
"""

import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Load environment variables from .env (lightweight, no pydantic needed here)
# ---------------------------------------------------------------------------
def load_env():
    env_path = Path(__file__).resolve().parents[2] / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip())

load_env()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Supabase client
# ---------------------------------------------------------------------------
try:
    from supabase import create_client
except ImportError:
    print("ERROR: supabase package not installed. Run: pip install supabase")
    sys.exit(1)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# ---------------------------------------------------------------------------
# Load hospital JSON
# ---------------------------------------------------------------------------
DATA_PATH = Path(__file__).resolve().parent / "data" / "lagos_hospitals.json"

if not DATA_PATH.exists():
    print(f"ERROR: {DATA_PATH} not found. Did you add the JSON file?")
    sys.exit(1)

with open(DATA_PATH) as f:
    hospitals_data = json.load(f)

print(f"Loaded {len(hospitals_data)} hospitals from JSON")

# ---------------------------------------------------------------------------
# Slugs that should have stale data (>8 hours old → grey on map)
# ---------------------------------------------------------------------------
STALE_SLUGS = {"ketu-ojota-hc", "ikorodu-eye-centre", "iwaya-maternity"}

# ---------------------------------------------------------------------------
# Helper: build PostGIS point string
# ---------------------------------------------------------------------------
def make_point(lng, lat):
    """Supabase/PostGIS expects POINT(longitude latitude) — lng first."""
    return f"POINT({lng} {lat})"

# ---------------------------------------------------------------------------
# Clear existing data (safe to re-run)
# ---------------------------------------------------------------------------
def clear_existing():
    print("Clearing existing seed data...")
    # Delete in order that respects foreign keys
    supabase.table("verification_signals").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    supabase.table("handshakes").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    supabase.table("queries").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    supabase.table("surge_predictions").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    supabase.table("hospital_beds").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    supabase.table("hospitals").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    print("Cleared.")

# ---------------------------------------------------------------------------
# Insert hospitals
# ---------------------------------------------------------------------------
def seed_hospitals():
    now = datetime.now(timezone.utc)
    inserted_count = 0
    bed_count = 0

    for h in hospitals_data:
        # Determine last_report_at based on stale flag
        is_stale = h.get("_stale", False) or h["slug"] in STALE_SLUGS
        if is_stale:
            # 10-14 hours ago → will show as grey on the map
            hours_ago = 10 + (inserted_count % 5)
            last_report = now - timedelta(hours=hours_ago)
        else:
            # 0.5 to 5 hours ago → varied freshness
            hours_ago = 0.5 + (inserted_count * 0.15)
            last_report = now - timedelta(hours=hours_ago)

        # Calculate freshness score: max(0, 1.0 - hours_since / 12.0)
        hours_since = (now - last_report).total_seconds() / 3600
        freshness = max(0.0, round(1.0 - (hours_since / 12.0), 3))

        # Build the hospital row
        hospital_row = {
            "name": h["name"],
            "slug": h["slug"],
            "location": make_point(h["longitude"], h["latitude"]),
            "address": h["address"],
            "lga": h["lga"],
            "city": h["city"],
            "phone": h.get("phone"),
            "whatsapp_number": h["whatsapp_number"],
            "email": h.get("email"),
            "hospital_type": h["hospital_type"],
            "has_icu": h.get("has_icu", False),
            "has_theatre": h.get("has_theatre", False),
            "has_blood_bank": h.get("has_blood_bank", False),
            "has_ct_scanner": h.get("has_ct_scanner", False),
            "has_mri": h.get("has_mri", False),
            "has_ventilators": h.get("has_ventilators", False),
            "has_dialysis": h.get("has_dialysis", False),
            "has_oxygen": h.get("has_oxygen", False),
            "has_xray": h.get("has_xray", False),
            "has_ultrasound": h.get("has_ultrasound", False),
            "has_pharmacy": h.get("has_pharmacy", False),
            "has_lab": h.get("has_lab", False),
            "has_ambulance": h.get("has_ambulance", False),
            "trust_tier": h.get("trust_tier", "active"),
            "accuracy_score": 0.85 if h.get("trust_tier") == "verified" else 0.5,
            "freshness_score": freshness,
            "total_beds": h.get("total_beds", 0),
            "is_active": True,
            "onboarded_at": (now - timedelta(days=30)).isoformat(),
            "last_report_at": last_report.isoformat(),
            "last_checkin_sent_at": (last_report - timedelta(hours=1)).isoformat(),
        }

        # Insert hospital
        result = supabase.table("hospitals").insert(hospital_row).execute()
        hospital_id = result.data[0]["id"]

        # Insert bed rows for each bed type
        for bed_type, bed_data in h.get("bed_types", {}).items():
            bed_row = {
                "hospital_id": hospital_id,
                "bed_type": bed_type,
                "total_count": bed_data["total"],
                "available_count": bed_data["available"],
                "overflow_count": bed_data.get("overflow", 0),
                # capacity_tier is set automatically by the database trigger
                "reported_by": "BedSignal Seed",
                "reported_at": last_report.isoformat(),
            }
            supabase.table("hospital_beds").insert(bed_row).execute()
            bed_count += 1

        inserted_count += 1
        status = "STALE" if is_stale else "OK"
        print(f"  [{inserted_count:02d}] {h['name'][:45]:45s} | {h['hospital_type']:10s} | {h['trust_tier']:10s} | {status}")

    print(f"\nDone! Inserted {inserted_count} hospitals and {bed_count} bed records.")

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print("=" * 65)
    print("  BedSignal — Hospital Seed Script")
    print("=" * 65)
    print()

    clear_existing()
    print()
    seed_hospitals()

    # Quick verification
    print()
    print("Verification:")
    h_count = supabase.table("hospitals").select("id", count="exact").execute()
    b_count = supabase.table("hospital_beds").select("id", count="exact").execute()
    print(f"  hospitals table:     {h_count.count} rows")
    print(f"  hospital_beds table: {b_count.count} rows")
    print()
    print("Step 2.2 complete. Next: python -m app.seed.predictions")
