from datetime import datetime, timezone

from fastapi import HTTPException

from app.database import supabase
from app.services.handshake_mgr import accept_handshake_record, create_handshake
from app.services.search_engine import _parse_location, search_nearby
from app.services.whatsapp import send_text


async def reroute_transport_request(transport_id: str) -> dict:
    """
    Reroute an active transport request to a new hospital and secure a replacement bed.
    """
    tr = supabase.table("transport_requests").select("*").eq("id", transport_id).execute()
    if not tr.data:
        raise HTTPException(status_code=404, detail="Transport request not found")

    transport = tr.data[0]

    if not transport.get("assignment_id"):
        raise HTTPException(status_code=400, detail="No ambulance assignment to reroute")

    assign = supabase.table("ambulance_assignments").select("*").eq("id", transport["assignment_id"]).execute()
    if not assign.data:
        raise HTTPException(status_code=404, detail="Assignment not found")

    assignment = assign.data[0]
    old_hospital_id = transport["destination_hospital_id"]

    parsed_requirements = {}
    old_hospital_name = "previous hospital"
    old_hospital_location = None

    if old_hospital_id:
        old_hospital = (
            supabase.table("hospitals")
            .select("name, location")
            .eq("id", old_hospital_id)
            .execute()
        )
        if old_hospital.data:
            old_hospital_name = old_hospital.data[0].get("name") or old_hospital_name
            old_hospital_location = old_hospital.data[0].get("location")

    if transport.get("handshake_id"):
        hs = (
            supabase.table("handshakes")
            .select("parsed_requirements, bed_type")
            .eq("id", transport["handshake_id"])
            .execute()
        )
        if hs.data:
            handshake_row = hs.data[0]
            parsed_requirements = handshake_row.get("parsed_requirements") or {}
            if not isinstance(parsed_requirements, dict):
                parsed_requirements = {}
            if not parsed_requirements.get("required_beds") and handshake_row.get("bed_type"):
                parsed_requirements["required_beds"] = [handshake_row["bed_type"]]

    assignment_status = assignment.get("status", "dispatched")
    if assignment_status in ("en_route_to_hospital", "at_scene"):
        lat = None
        lng = None
        if old_hospital_location:
            lat, lng = _parse_location(old_hospital_location)
        if lat is None or lng is None:
            lat = transport.get("pickup_lat") or 6.5244
            lng = transport.get("pickup_lng") or 3.3792
    else:
        lat = transport.get("pickup_lat") or 6.5244
        lng = transport.get("pickup_lng") or 3.3792

    required_equipment = parsed_requirements.get("required_equipment", []) if isinstance(parsed_requirements, dict) else []
    bed_type = None
    if isinstance(parsed_requirements, dict) and parsed_requirements.get("required_beds"):
        bed_type = parsed_requirements["required_beds"][0]

    results, _query_id = await search_nearby(
        lat=lat,
        lng=lng,
        radius_km=25,
        bed_type=bed_type,
        include_overflow=True,
        limit=5,
        required_equipment=required_equipment,
        query_type="reroute",
        channel="web",
    )
    results = [result for result in results if result["hospital_id"] != old_hospital_id]

    if not results:
        supabase.table("transport_requests").update({
            "status": "reroute_failed",
        }).eq("id", transport_id).execute()
        return {
            "status": "reroute_failed",
            "message": "No alternative hospital found",
            "new_hospital": None,
        }

    new_hospital = results[0]
    new_hospital_id = new_hospital["hospital_id"]
    new_hospital_info = {
        "id": new_hospital_id,
        "name": new_hospital.get("name") or "Alternative hospital",
        "address": new_hospital.get("address") or "",
    }

    new_hs = await create_handshake(
        receiving_hospital_id=new_hospital_id,
        bed_type=bed_type or "emergency",
        requesting_party_type="ambulance_reroute",
        requesting_party_phone=transport["patient_phone"],
        patient_summary=f"Rerouted from {old_hospital_name} — ambulance en route",
        parsed_requirements=parsed_requirements if isinstance(parsed_requirements, dict) else None,
        hold_duration_min=60,
    )
    accepted_handshake = await accept_handshake_record(new_hs)

    if not accepted_handshake:
        supabase.table("transport_requests").update({
            "status": "reroute_failed",
        }).eq("id", transport_id).execute()
        raise HTTPException(status_code=409, detail="Could not secure a bed at the rerouted hospital")

    supabase.table("ambulance_assignments").update({
        "destination_hospital_id": new_hospital_id,
        "handshake_id": new_hs["id"],
    }).eq("id", transport["assignment_id"]).execute()

    supabase.table("transport_requests").update({
        "destination_hospital_id": new_hospital_id,
        "status": "rerouted",
        "handshake_id": new_hs["id"],
    }).eq("id", transport_id).execute()

    supabase.table("ambulance_status_updates").insert({
        "assignment_id": transport["assignment_id"],
        "status": "rerouted",
        "note": f"Rerouted from {old_hospital_name} to {new_hospital_info['name']}",
    }).execute()

    amb = supabase.table("ambulances").select("crew_phone, vehicle_id").eq("id", assignment["ambulance_id"]).execute()
    if amb.data and amb.data[0].get("crew_phone"):
        await send_text(amb.data[0]["crew_phone"], (
            f"⚠️ *DESTINATION CHANGED — {amb.data[0]['vehicle_id']}*\n\n"
            f"Previous: {old_hospital_name}\n"
            f"New destination: *{new_hospital_info['name']}*\n"
            f"Address: {new_hospital_info.get('address', 'See navigation')}\n"
            f"Transfer code: *{new_hs['transfer_code']}*\n\n"
            "A replacement bed has been confirmed at the new hospital."
        ))

    await send_text(transport["patient_phone"], (
        f"⚠️ *Your ambulance has been rerouted.*\n\n"
        f"The original hospital could no longer receive you.\n"
        f"New hospital: *{new_hospital_info['name']}*\n"
        f"Transfer code: *{new_hs['transfer_code']}*\n\n"
        "Your replacement bed has been confirmed and the crew is heading there now."
    ))

    print(f"   🔄 TRANSPORT REROUTED: {transport_id[:8]} → {new_hospital_info['name']}")

    return {
        "status": "rerouted",
        "old_hospital": old_hospital_name,
        "new_hospital": new_hospital_info,
        "new_transfer_code": new_hs["transfer_code"],
        "new_handshake_id": new_hs["id"],
    }
