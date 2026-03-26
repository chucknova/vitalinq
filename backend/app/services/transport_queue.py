"""
Transport request helpers built on top of accepted handshakes.

This keeps the hackathon implementation lightweight by storing transport
state inside the handshake's parsed_requirements JSON rather than
introducing a new table and migration.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.database import supabase
from app.services.search_engine import _parse_location


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    import math

    r = 6371
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlng / 2) ** 2
    )
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _estimate_eta_minutes(distance_km: float) -> int:
    # Lagos traffic demo heuristic: average 35 km/h with a short dispatch buffer.
    travel_minutes = (distance_km / 35) * 60 if distance_km > 0 else 0
    return max(8, round(travel_minutes + 6))


def _transport_from(parsed_requirements: dict | None) -> dict[str, Any] | None:
    if not isinstance(parsed_requirements, dict):
        return None
    transport = parsed_requirements.get("transport")
    return transport if isinstance(transport, dict) else None


def _with_transport(parsed_requirements: dict | None, transport: dict[str, Any]) -> dict[str, Any]:
    parsed = dict(parsed_requirements or {})
    parsed["transport"] = transport
    return parsed


def get_handshake(handshake_id: str) -> dict | None:
    result = (
        supabase.table("handshakes")
        .select("*")
        .eq("id", handshake_id)
        .execute()
    )
    return result.data[0] if result.data else None


def get_transport_providers(pickup_lat: float, pickup_lng: float, limit: int = 5) -> list[dict[str, Any]]:
    hospitals = (
        supabase.table("hospitals")
        .select("id, name, address, phone, whatsapp_number, location, has_ambulance, is_active")
        .eq("is_active", True)
        .eq("has_ambulance", True)
        .execute()
    ).data or []

    providers = []
    for hospital in hospitals:
        lat, lng = _parse_location(hospital.get("location"))
        if lat is None:
            continue
        distance_km = _haversine(pickup_lat, pickup_lng, lat, lng)
        providers.append({
            "provider_id": hospital["id"],
            "name": hospital["name"],
            "address": hospital.get("address"),
            "phone": hospital.get("phone"),
            "whatsapp_number": hospital.get("whatsapp_number"),
            "lat": lat,
            "lng": lng,
            "distance_km": round(distance_km, 1),
            "eta_min": _estimate_eta_minutes(distance_km),
        })

    providers.sort(key=lambda provider: provider["distance_km"])
    return providers[:limit]


def update_transport(handshake_id: str, transport: dict[str, Any]) -> dict[str, Any]:
    handshake = get_handshake(handshake_id)
    if not handshake:
        raise ValueError("Handshake not found")

    parsed = _with_transport(handshake.get("parsed_requirements"), transport)
    updated = (
        supabase.table("handshakes")
        .update({"parsed_requirements": parsed})
        .eq("id", handshake_id)
        .execute()
    )
    return updated.data[0] if updated.data else {**handshake, "parsed_requirements": parsed}


def request_transport(
    handshake_id: str,
    pickup_lat: float,
    pickup_lng: float,
    pickup_address: str | None = None,
) -> dict[str, Any]:
    handshake = get_handshake(handshake_id)
    if not handshake:
        raise ValueError("Handshake not found")
    if handshake.get("status") != "accepted":
        raise ValueError("Transport can only be requested for accepted reservations")

    providers = get_transport_providers(pickup_lat, pickup_lng, limit=3)
    transport = {
        "status": "requested",
        "requested_at": _now_iso(),
        "pickup_lat": pickup_lat,
        "pickup_lng": pickup_lng,
        "pickup_address": pickup_address,
        "provider_suggestions": providers,
    }
    updated = update_transport(handshake_id, transport)
    return _transport_from(updated.get("parsed_requirements")) or transport


def dispatch_transport(handshake_id: str, provider_id: str | None = None) -> dict[str, Any]:
    handshake = get_handshake(handshake_id)
    if not handshake:
        raise ValueError("Handshake not found")

    transport = _transport_from(handshake.get("parsed_requirements"))
    if not transport:
        raise ValueError("No transport request found")

    pickup_lat = transport.get("pickup_lat")
    pickup_lng = transport.get("pickup_lng")
    if pickup_lat is None or pickup_lng is None:
        raise ValueError("Transport request is missing pickup coordinates")

    providers = get_transport_providers(pickup_lat, pickup_lng, limit=5)
    provider = None
    if provider_id:
        provider = next((item for item in providers if item["provider_id"] == provider_id), None)
    if provider is None and providers:
        provider = providers[0]
    if provider is None:
        raise ValueError("No ambulance-capable providers found")

    updated_transport = {
        **transport,
        "status": "dispatched",
        "dispatched_at": _now_iso(),
        "provider_id": provider["provider_id"],
        "provider_name": provider["name"],
        "provider_phone": provider.get("phone"),
        "provider_whatsapp_number": provider.get("whatsapp_number"),
        "provider_eta_min": provider["eta_min"],
    }
    updated = update_transport(handshake_id, updated_transport)
    return _transport_from(updated.get("parsed_requirements")) or updated_transport


def list_transport_requests() -> list[dict[str, Any]]:
    handshakes = (
        supabase.table("handshakes")
        .select("id, status, transfer_code, patient_summary, parsed_requirements, receiving_hospital_id, created_at")
        .eq("status", "accepted")
        .order("created_at", desc=True)
        .execute()
    ).data or []

    hospital_ids = list({hs["receiving_hospital_id"] for hs in handshakes if hs.get("receiving_hospital_id")})
    hospitals_map = {}
    if hospital_ids:
        hospitals = (
            supabase.table("hospitals")
            .select("id, name, address, phone")
            .in_("id", hospital_ids)
            .execute()
        ).data or []
        hospitals_map = {hospital["id"]: hospital for hospital in hospitals}

    requests = []
    for handshake in handshakes:
        transport = _transport_from(handshake.get("parsed_requirements"))
        if not transport or transport.get("status") not in {"requested", "dispatched"}:
            continue

        hospital = hospitals_map.get(handshake["receiving_hospital_id"], {})
        parsed = handshake.get("parsed_requirements") or {}
        requests.append({
            "handshake_id": handshake["id"],
            "transfer_code": handshake.get("transfer_code"),
            "handshake_status": handshake.get("status"),
            "patient_summary": handshake.get("patient_summary"),
            "urgency": parsed.get("urgency"),
            "pickup_lat": transport.get("pickup_lat"),
            "pickup_lng": transport.get("pickup_lng"),
            "pickup_address": transport.get("pickup_address"),
            "transport": transport,
            "destination_hospital": {
                "id": hospital.get("id"),
                "name": hospital.get("name"),
                "address": hospital.get("address"),
                "phone": hospital.get("phone"),
            },
            "provider_suggestions": transport.get("provider_suggestions") or [],
            "created_at": handshake.get("created_at"),
        })

    return requests
