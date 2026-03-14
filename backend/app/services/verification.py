"""
Verification signal handler — processes Ghost Bed Detection responses.

When a patient responds to "Were you admitted?":
  - YES → positive signal → hospital accuracy goes up
  - NO  → negative signal → hospital accuracy goes down

After each signal, recalculates:
  - accuracy_score: positive signals / total signals (last 30 days)
  - trust_tier: verified (≥0.8, 5+ signals), active (≥0.5 or <5 signals), unverified (<0.5, 5+ signals)

Usage:
    from app.services.verification import handle_verification_response
    await handle_verification_response(query_id, "positive", reporter_phone)
"""

import hashlib
from datetime import datetime, timezone, timedelta
from app.database import supabase


async def handle_verification_response(
    query_id: str,
    signal_value: str,
    reporter_phone: str | None = None,
) -> dict | None:
    """
    Process a patient's follow-up response.

    Args:
        query_id: The original search query ID
        signal_value: "positive" (yes, admitted) or "negative" (no, turned away)
        reporter_phone: Phone of the person responding (hashed before storage)

    Returns:
        The updated hospital dict, or None if query not found.
    """

    # Fetch the query to get the hospital
    query = (
        supabase.table("queries")
        .select("id, selected_hospital_id")
        .eq("id", query_id)
        .execute()
    )

    if not query.data or not query.data[0].get("selected_hospital_id"):
        print(f"⚠️ VERIFY: Query {query_id[:8]} not found or no hospital selected")
        return None

    hospital_id = query.data[0]["selected_hospital_id"]

    # Find associated handshake (if any)
    handshake = (
        supabase.table("handshakes")
        .select("id")
        .eq("query_id", query_id)
        .limit(1)
        .execute()
    )
    handshake_id = handshake.data[0]["id"] if handshake.data else None

    # Hash the phone number for privacy
    phone_hash = None
    if reporter_phone:
        phone_hash = hashlib.sha256(reporter_phone.encode()).hexdigest()[:20]

    # Create the verification signal
    signal = {
        "hospital_id": hospital_id,
        "signal_type": "patient_followup",
        "signal_value": signal_value,
        "query_id": query_id,
        "handshake_id": handshake_id,
        "reporter_phone": phone_hash,
    }

    supabase.table("verification_signals").insert(signal).execute()

    print(f"{'✅' if signal_value == 'positive' else '❌'} VERIFY: {signal_value} signal for hospital {hospital_id[:8]}")

    # Recalculate accuracy score
    updated_hospital = await recalculate_accuracy(hospital_id)
    return updated_hospital


async def recalculate_accuracy(hospital_id: str) -> dict | None:
    """
    Recalculate a hospital's accuracy_score and trust_tier
    based on verification signals from the last 30 days.

    Formula:
        accuracy = positive_count / total_count

    Trust tier thresholds:
        accuracy ≥ 0.8 AND total ≥ 5  → "verified"
        accuracy ≥ 0.5 OR total < 5   → "active"
        accuracy < 0.5 AND total ≥ 5  → "unverified"
    """
    thirty_days_ago = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()

    # Count signals
    all_signals = (
        supabase.table("verification_signals")
        .select("signal_value")
        .eq("hospital_id", hospital_id)
        .gt("created_at", thirty_days_ago)
        .execute()
    )

    if not all_signals.data:
        # No signals — leave as is
        return None

    total = len(all_signals.data)
    positive = sum(1 for s in all_signals.data if s["signal_value"] == "positive")

    accuracy = positive / total if total > 0 else 0.5

    # Determine trust tier
    if accuracy >= 0.8 and total >= 5:
        trust_tier = "verified"
    elif accuracy < 0.5 and total >= 5:
        trust_tier = "unverified"
    else:
        trust_tier = "active"

    # Update hospital
    supabase.table("hospitals").update({
        "accuracy_score": round(accuracy, 3),
        "trust_tier": trust_tier,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", hospital_id).execute()

    print(f"   📊 Hospital {hospital_id[:8]}: accuracy={accuracy:.0%} ({positive}/{total}) → {trust_tier}")

    return {"accuracy_score": accuracy, "trust_tier": trust_tier, "total_signals": total}
