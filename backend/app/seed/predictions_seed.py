"""
Seed script: Generate synthetic surge predictions for all hospitals.

Creates occupancy forecasts for every hospital × bed type × day × hour.
Patterns are based on real-world Lagos hospital behavior so the demo
looks believable to judges.

Usage:
    cd backend
    python -m app.seed.predictions

Prerequisites:
    - Hospitals already seeded (run app.seed.hospitals first)
    - .env file with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
"""

import os
import sys
import random
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Load .env
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

try:
    from supabase import create_client
except ImportError:
    print("ERROR: supabase package not installed. Run: pip install supabase")
    sys.exit(1)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# ---------------------------------------------------------------------------
# Seed for reproducibility (same "random" data each run)
# ---------------------------------------------------------------------------
random.seed(42)

# ---------------------------------------------------------------------------
# Day constants (Postgres EXTRACT(DOW) uses 0=Sunday, but PRD says 0=Monday)
# We follow the PRD: 0=Monday ... 4=Friday, 5=Saturday, 6=Sunday
# ---------------------------------------------------------------------------
MON, TUE, WED, THU, FRI, SAT, SUN = 0, 1, 2, 3, 4, 5, 6

# ---------------------------------------------------------------------------
# Base occupancy patterns by hour of day
#
# These are multipliers (0.0 to 1.0) applied on top of the hospital's
# baseline. Think of them as "how busy is this bed type at this hour
# compared to its peak?"
# ---------------------------------------------------------------------------

def base_curve_emergency(hour):
    """Emergency beds: quiet mornings, busy evenings, peak late night."""
    if 2 <= hour <= 6:
        return 0.45
    elif 7 <= hour <= 11:
        return 0.55
    elif 12 <= hour <= 16:
        return 0.65
    elif 17 <= hour <= 21:
        return 0.80
    else:  # 22-1
        return 0.85


def base_curve_icu(hour):
    """ICU: consistently high, slight dip early morning."""
    if 3 <= hour <= 6:
        return 0.70
    elif 7 <= hour <= 14:
        return 0.80
    else:
        return 0.85


def base_curve_ward(hour):
    """Ward: builds through morning (admissions), stable afternoon, dips at night."""
    if 0 <= hour <= 5:
        return 0.55
    elif 6 <= hour <= 9:
        return 0.70  # morning admissions
    elif 10 <= hour <= 17:
        return 0.75
    elif 18 <= hour <= 21:
        return 0.65  # some discharges
    else:
        return 0.60


def base_curve_maternity(hour):
    """Maternity: relatively steady, slight increase overnight (labor tends to peak at night)."""
    if 0 <= hour <= 5:
        return 0.75
    elif 6 <= hour <= 11:
        return 0.65
    elif 12 <= hour <= 18:
        return 0.60
    else:
        return 0.70


def base_curve_surgical(hour):
    """Surgical: peaks during operating hours, low overnight."""
    if 7 <= hour <= 16:
        return 0.80
    elif 17 <= hour <= 20:
        return 0.65  # recovery
    else:
        return 0.45


def base_curve_pediatric(hour):
    """Pediatric: similar to ward but lower baseline."""
    if 0 <= hour <= 6:
        return 0.50
    elif 7 <= hour <= 12:
        return 0.65
    elif 13 <= hour <= 18:
        return 0.60
    else:
        return 0.55


def base_curve_psychiatric(hour):
    """Psychiatric: very stable occupancy throughout the day."""
    return 0.70


BASE_CURVES = {
    "emergency": base_curve_emergency,
    "icu": base_curve_icu,
    "ward": base_curve_ward,
    "maternity": base_curve_maternity,
    "surgical": base_curve_surgical,
    "pediatric": base_curve_pediatric,
    "psychiatric": base_curve_psychiatric,
}


# ---------------------------------------------------------------------------
# Day-of-week modifiers
#
# These bump occupancy up or down depending on the day.
# Values are additive (e.g., +0.10 means add 10% to the base).
# ---------------------------------------------------------------------------

DAY_MODIFIERS = {
    "emergency": {
        MON: 0.0, TUE: 0.0, WED: 0.0, THU: 0.02,
        FRI: 0.10, SAT: 0.15, SUN: 0.08,
    },
    "icu": {
        MON: 0.05, TUE: 0.03, WED: 0.0, THU: 0.0,
        FRI: 0.05, SAT: 0.08, SUN: 0.05,
    },
    "ward": {
        MON: 0.10, TUE: 0.05, WED: 0.0, THU: 0.0,  # Monday admission surge
        FRI: -0.05, SAT: -0.08, SUN: -0.05,
    },
    "maternity": {
        MON: 0.0, TUE: 0.0, WED: 0.0, THU: 0.0,
        FRI: 0.03, SAT: 0.05, SUN: 0.03,
    },
    "surgical": {
        MON: 0.10, TUE: 0.08, WED: 0.05, THU: 0.05,  # Elective surgeries weekdays
        FRI: 0.0, SAT: -0.20, SUN: -0.25,  # No electives on weekends
    },
    "pediatric": {
        MON: 0.05, TUE: 0.0, WED: 0.0, THU: 0.0,
        FRI: 0.03, SAT: 0.05, SUN: 0.03,
    },
    "psychiatric": {
        MON: 0.0, TUE: 0.0, WED: 0.0, THU: 0.0,
        FRI: 0.0, SAT: 0.0, SUN: 0.0,
    },
}

# ---------------------------------------------------------------------------
# Friday/Saturday night spike (trauma hours: 18:00 - 02:00)
# This is the big demo moment — the heatmap should light up on weekend nights
# ---------------------------------------------------------------------------

def weekend_night_spike(day, hour, bed_type):
    """Extra boost for trauma-related beds on Friday/Saturday nights."""
    if bed_type not in ("emergency", "icu", "surgical"):
        return 0.0

    is_friday_night = (day == FRI and hour >= 18)
    is_saturday = (day == SAT)
    is_saturday_night = (day == SAT and hour >= 18)
    is_sunday_early = (day == SUN and hour <= 2)

    if is_friday_night or is_saturday_night or is_sunday_early:
        # Peak spike: 85-95% target
        return 0.12
    elif is_saturday and hour < 18:
        # Saturday daytime: elevated but not peak
        return 0.05
    return 0.0


# ---------------------------------------------------------------------------
# Hospital type baseline modifier
#
# Teaching hospitals run hotter. Private hospitals are lower baseline
# but spike sharply during off-hours (they get the overflow).
# ---------------------------------------------------------------------------

HOSPITAL_TYPE_BASELINES = {
    "teaching": 0.10,      # +10% — always busier
    "general": 0.0,        # baseline
    "specialist": -0.05,   # slightly lower (focused patient pool)
    "private": -0.10,      # lower baseline (capacity managed tighter)
    "maternity": 0.05,     # dedicated maternity runs warm
    "clinic": -0.15,       # small, lower overall occupancy
}


# ---------------------------------------------------------------------------
# Generate predictions
# ---------------------------------------------------------------------------

def generate_prediction(base_occupancy, day, hour, bed_type, hospital_type):
    """
    Combine all modifiers to produce a single predicted_occupancy_pct.

    Formula:
        base_curve(hour)
        + day_modifier(day, bed_type)
        + weekend_night_spike(day, hour, bed_type)
        + hospital_type_baseline(hospital_type)
        + random_noise(±5-10%)

    Clamped to [0.05, 0.98] — no hospital is ever truly 0% or 100%.
    """
    # Start with the hourly curve for this bed type
    curve_fn = BASE_CURVES.get(bed_type, base_curve_ward)
    value = curve_fn(hour)

    # Add day-of-week modifier
    day_mod = DAY_MODIFIERS.get(bed_type, {}).get(day, 0.0)
    value += day_mod

    # Add weekend night spike
    value += weekend_night_spike(day, hour, bed_type)

    # Add hospital type baseline
    value += HOSPITAL_TYPE_BASELINES.get(hospital_type, 0.0)

    # Add random noise: ±5-10%
    noise = random.uniform(-0.10, 0.10)
    value += noise

    # Clamp
    value = max(0.05, min(0.98, value))

    # Confidence: higher for well-known patterns, lower for noisy hours
    confidence = 0.75 + random.uniform(-0.10, 0.15)
    confidence = max(0.50, min(0.95, confidence))

    return round(value, 3), round(confidence, 3)


# ---------------------------------------------------------------------------
# Main seeding logic
# ---------------------------------------------------------------------------

def seed_predictions():
    print("Clearing existing surge predictions...")
    supabase.table("surge_predictions").delete().neq(
        "id", "00000000-0000-0000-0000-000000000000"
    ).execute()
    print("Cleared.")

    # Fetch all hospitals with their bed types
    hospitals = supabase.table("hospitals").select("id, name, hospital_type, slug").execute().data
    print(f"Generating predictions for {len(hospitals)} hospitals...")

    # Get bed types per hospital
    all_beds = supabase.table("hospital_beds").select("hospital_id, bed_type").execute().data

    beds_by_hospital = {}
    for b in all_beds:
        hid = b["hospital_id"]
        if hid not in beds_by_hospital:
            beds_by_hospital[hid] = []
        beds_by_hospital[hid].append(b["bed_type"])

    now = datetime.now(timezone.utc)
    total_rows = 0
    batch = []
    BATCH_SIZE = 500  # Insert in chunks to avoid timeout

    for h in hospitals:
        hid = h["id"]
        htype = h["hospital_type"]
        bed_types = beds_by_hospital.get(hid, [])

        for bed_type in bed_types:
            for day in range(7):       # 0=Monday to 6=Sunday
                for hour in range(24):  # 0 to 23
                    occ, conf = generate_prediction(
                        base_occupancy=0,  # not used directly, curves handle it
                        day=day,
                        hour=hour,
                        bed_type=bed_type,
                        hospital_type=htype,
                    )

                    batch.append({
                        "hospital_id": hid,
                        "bed_type": bed_type,
                        "day_of_week": day,
                        "hour": hour,
                        "predicted_occupancy_pct": occ,
                        "confidence": conf,
                        "generated_at": now.isoformat(),
                    })

                    if len(batch) >= BATCH_SIZE:
                        supabase.table("surge_predictions").insert(batch).execute()
                        total_rows += len(batch)
                        batch = []

    # Insert remaining
    if batch:
        supabase.table("surge_predictions").insert(batch).execute()
        total_rows += len(batch)

    print(f"\nDone! Inserted {total_rows:,} prediction rows.")
    return total_rows


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("=" * 65)
    print("  BedSignal — Surge Predictions Seed Script")
    print("=" * 65)
    print()

    total = seed_predictions()

    # Quick stats
    print()
    print("Verification:")
    count = supabase.table("surge_predictions").select("id", count="exact").execute()
    print(f"  surge_predictions table: {count.count:,} rows")

    # Show a sample: Friday 10pm emergency predictions
    print()
    print("Sample — Friday 10PM emergency predictions (top 5):")
    sample = (
        supabase.table("surge_predictions")
        .select("hospital_id, bed_type, predicted_occupancy_pct, confidence")
        .eq("day_of_week", 4)   # Friday
        .eq("hour", 22)         # 10PM
        .eq("bed_type", "emergency")
        .order("predicted_occupancy_pct", desc=True)
        .limit(5)
        .execute()
    )
    for row in sample.data:
        pct = row["predicted_occupancy_pct"]
        conf = row["confidence"]
        print(f"  {pct*100:5.1f}% occupancy (confidence: {conf:.2f})")

    print()
    print("Step 2.3 complete. Your database is fully seeded!")
    print("Next up: Phase 3 — scaffold the backend API.")
