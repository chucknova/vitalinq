"""
Freshness Score Updater — runs every 15 minutes.

Recalculates freshness_score for all active hospitals based on
how long ago they last reported bed data.

Formula: freshness = max(0, 1.0 - hours_since_last_report / 12.0)

  - Just reported:  1.0
  - 2 hours ago:    0.83
  - 6 hours ago:    0.50
  - 8 hours ago:    0.33
  - 12+ hours ago:  0.0
"""

from datetime import datetime, timezone
from app.database import supabase


async def update_freshness_scores():
    """Recalculate freshness scores for all active hospitals."""
    now = datetime.now(timezone.utc)

    hospitals = (
        supabase.table("hospitals")
        .select("id, last_report_at")
        .eq("is_active", True)
        .execute()
    )

    if not hospitals.data:
        return

    updated = 0

    for h in hospitals.data:
        last_report = h.get("last_report_at")

        if not last_report:
            freshness = 0.0
        else:
            if isinstance(last_report, str):
                last_report = datetime.fromisoformat(last_report.replace("Z", "+00:00"))
            hours_since = (now - last_report).total_seconds() / 3600
            freshness = max(0.0, round(1.0 - (hours_since / 12.0), 3))

        supabase.table("hospitals").update({
            "freshness_score": freshness,
            "updated_at": now.isoformat(),
        }).eq("id", h["id"]).execute()

        updated += 1

    print(f"🔄 FRESHNESS: Updated {updated} hospitals")
