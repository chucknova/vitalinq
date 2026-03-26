"""
Conversational triage orchestration for the web booking flow.

This service turns a freeform multi-turn chat into either:
  1. A follow-up question when the situation is still ambiguous, or
  2. A ranked hospital search once we have enough signal to route care.
"""

from __future__ import annotations

import json
import re
from typing import Any

import anthropic

from app.config import settings
from app.services.search_engine import search_nearby
from app.services.triage import parse_emergency

client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)


CHAT_SYSTEM_PROMPT = """You are the BedSignal triage chat assistant for a hospital bed-finding system in Lagos, Nigeria.

Your job is to decide whether the latest user message is clear enough to search for hospitals now, or whether you should ask one short follow-up question first.

Return ONLY valid JSON in this shape:
{
  "action": "ask_followup" | "search_now",
  "assistant_message": "string",
  "reason": "short internal reason",
  "search_focus": "one short phrase"
}

Rules:
- Keep assistant_message concise, calm, and practical.
- Ask at most one follow-up question.
- Only ask follow-up when the request is genuinely ambiguous for routing.
- If there are red-flag symptoms like unconsciousness, severe bleeding, seizures, breathing trouble, poisoning, stroke symptoms, chest pain, or major trauma, prefer search_now.
- If the patient is a child and the problem is poisoning/exposure, ask about the child's age and current symptoms only if those are missing.
- If action is search_now, the message should briefly summarize what you're looking for and mention that you'll use the patient's current location.
- Never mention JSON or internal reasoning.
"""


def _user_transcript(messages: list[dict[str, str]]) -> str:
    return "\n".join(msg["content"].strip() for msg in messages if msg["role"] == "user")


def _fallback_decision(messages: list[dict[str, str]]) -> dict[str, str]:
    transcript = _user_transcript(messages).lower()
    latest_user = next(
        (msg["content"].strip() for msg in reversed(messages) if msg["role"] == "user"),
        "",
    )

    poison_words = (
        "poison", "chemical", "bleach", "detergent", "under the sink",
        "drank", "swallowed", "ate", "cleaner",
    )
    red_flags = (
        "not responding", "unconscious", "can't breathe", "cannot breathe",
        "bleeding", "bleeding heavily", "seizure", "convulsion", "collapsed",
        "head injury", "fell", "stroke", "chest pain", "roof", "crash",
    )

    if any(word in transcript for word in poison_words):
        has_age = bool(re.search(r"\b(\d{1,2})\b", transcript)) or any(
            word in transcript for word in ("baby", "toddler", "child", "kid", "infant")
        )
        has_symptoms = any(
            word in transcript for word in (
                "vomit", "vomiting", "sleepy", "drowsy", "breathing", "cough",
                "foam", "foaming", "seizure", "pain", "burn", "unconscious",
            )
        )
        if not (has_age and has_symptoms):
            return {
                "action": "ask_followup",
                "assistant_message": (
                    "I need one quick detail before I route this: how old is the child, "
                    "what do you think they swallowed, and are they awake and breathing normally?"
                ),
                "reason": "poisoning needs age and symptom check",
                "search_focus": "poisoning exposure",
            }

    if len(latest_user.split()) < 5:
        return {
            "action": "ask_followup",
            "assistant_message": (
                "Tell me what happened and the most urgent symptom right now, "
                "for example bleeding, unconsciousness, breathing trouble, or severe pain."
            ),
            "reason": "too little detail",
            "search_focus": "unclear emergency",
        }

    if any(word in transcript for word in red_flags):
        return {
            "action": "search_now",
            "assistant_message": "This sounds urgent. I'm checking nearby hospitals that can handle this and using your current location now.",
            "reason": "red flag symptom present",
            "search_focus": "high-acuity emergency",
        }

    if len(transcript.split()) < 12:
        return {
            "action": "ask_followup",
            "assistant_message": "What is the patient's age, and what symptom worries you most right now?",
            "reason": "needs one more routing detail",
            "search_focus": "general triage",
        }

    return {
        "action": "search_now",
        "assistant_message": "Thanks. I have enough to check nearby hospitals and I’m using your current location now.",
        "reason": "enough detail collected",
        "search_focus": "general emergency",
    }


async def decide_next_step(messages: list[dict[str, str]]) -> dict[str, str]:
    try:
        transcript = "\n".join(
            f"{msg['role'].upper()}: {msg['content'].strip()}" for msg in messages
        )
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=250,
            system=CHAT_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": transcript}],
        )
        text = message.content[0].text.strip()
        if text.startswith("```"):
            text = text.removeprefix("```json").removeprefix("```")
        if text.endswith("```"):
            text = text.removesuffix("```")
        result = json.loads(text.strip())

        if result.get("action") not in {"ask_followup", "search_now"}:
            return _fallback_decision(messages)
        if not result.get("assistant_message"):
            return _fallback_decision(messages)

        return result
    except (json.JSONDecodeError, anthropic.APIError, Exception) as exc:
        print(f"⚠️ TRIAGE CHAT: falling back to heuristics ({exc})")
        return _fallback_decision(messages)


def _format_search_message(parsed: dict[str, Any], hospital_count: int) -> str:
    condition = parsed.get("condition_category", "emergency care").replace("_", " ")
    urgency = parsed.get("urgency", "medium")
    equipment = [item.replace("_", " ") for item in parsed.get("required_equipment", [])[:3]]

    equipment_text = ""
    if equipment:
        equipment_text = f" with {', '.join(equipment)}"

    prefix = {
        "critical": "This looks critical.",
        "high": "This needs urgent care.",
        "medium": "This may need hospital assessment.",
        "low": "This looks lower urgency.",
    }.get(urgency, "I'm reviewing this now.")

    return (
        f"{prefix} I found {hospital_count} nearby option"
        f"{'' if hospital_count == 1 else 's'} for {condition}{equipment_text}."
    )


async def run_triage_chat(
    messages: list[dict[str, str]],
    latitude: float,
    longitude: float,
    radius_km: float = 20,
) -> dict[str, Any]:
    decision = await decide_next_step(messages)

    if decision["action"] == "ask_followup":
        return {
            "assistant_message": decision["assistant_message"],
            "should_search": False,
            "parsed_requirements": None,
            "results": [],
            "query_id": None,
        }

    transcript = _user_transcript(messages)
    parsed = await parse_emergency(transcript)
    results, query_id = await search_nearby(
        lat=latitude,
        lng=longitude,
        radius_km=radius_km,
        bed_type=parsed["required_beds"][0] if parsed["required_beds"] else None,
        include_overflow=True,
        limit=5,
        required_equipment=parsed["required_equipment"],
        query_type="triage_chat",
        query_text=transcript,
        channel="web",
    )

    assistant_message = _format_search_message(parsed, len(results))
    if not results:
        assistant_message = (
            "I couldn't find a strong nearby match yet, but I checked your current location. "
            "You can still review the closest hospitals below."
        )

    return {
        "assistant_message": assistant_message,
        "should_search": True,
        "parsed_requirements": parsed,
        "results": results,
        "query_id": query_id,
    }
