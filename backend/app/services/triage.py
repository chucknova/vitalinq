"""
Smart Triage Router — Claude AI integration for BedSignal.

Takes a natural language emergency description like:
    "68 year old man fell from ladder, not responding, bleeding from head"

And returns structured requirements like:
    {
        "urgency": "critical",
        "required_beds": ["icu"],
        "required_equipment": ["ct_scanner", "blood_bank"],
        "required_specialists": ["neurosurgeon"],
        "condition_category": "traumatic_brain_injury"
    }

These requirements are then used to run an enriched hospital search
that matches patients to hospitals with the right capabilities.

Usage:
    from app.services.triage import parse_emergency

    result = await parse_emergency("My father collapsed, he's diabetic, hit his head")
"""

import json
import anthropic
from app.config import settings


# ---------------------------------------------------------------------------
# Claude client
# ---------------------------------------------------------------------------
client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)


# ---------------------------------------------------------------------------
# System prompt — this is the core of the triage logic.
# Taken directly from Section 5.2 of the PRD.
# ---------------------------------------------------------------------------

TRIAGE_SYSTEM_PROMPT = """You are a medical triage assistant for BedSignal, a hospital \
bed-finding system in Lagos, Nigeria.

Given a description of a medical emergency, extract the following \
as a JSON object. Return ONLY valid JSON, no other text.

{
    "urgency": "critical" | "high" | "medium" | "low",
    "required_beds": ["icu", "ward", "maternity", "pediatric", "emergency", "surgical"],
    "required_equipment": ["ct_scanner", "mri", "blood_bank", "ventilators", "dialysis", "oxygen", "xray", "ultrasound", "theatre", "lab"],
    "required_specialists": ["neurosurgeon", "cardiologist", "endocrinologist", "pediatrician", "obstetrician", "orthopedic_surgeon", "general_surgeon", "intensivist", "anesthesiologist"],
    "condition_category": "string describing the likely condition",
    "self_care_advice": ["string", "string"]
}

Rules:
- Only include beds, equipment, and specialists that are actually needed
- Be conservative: if unsure, include the equipment/specialist
- For trauma with head injury, always include ct_scanner and neurosurgeon
- For diabetic emergencies, include endocrinologist and lab
- For pregnancy/labor, always use maternity bed type and obstetrician
- For children under 12, prefer pediatric bed type
- For breathing difficulty, include oxygen and ventilators
- For chest pain / cardiac symptoms, include icu and cardiologist
- For burns, include surgical bed and theatre
- For fractures / orthopedic injuries, include xray and orthopedic_surgeon
- If the description is too vague, return urgency="medium" and required_beds=["emergency"] with minimal equipment
- If urgency is "low", include 2-3 brief, practical self-care suggestions in self_care_advice. Keep advice safe and conservative. Always end with "If symptoms worsen, seek medical attention immediately."
- If urgency is "medium", "high", or "critical", set self_care_advice to an empty array []
- Return ONLY the JSON object, no markdown, no explanation, no backticks"""


# ---------------------------------------------------------------------------
# Safe default — returned when Claude fails or description is too vague
# ---------------------------------------------------------------------------

SAFE_DEFAULT = {
    "urgency": "medium",
    "required_beds": ["emergency"],
    "required_equipment": ["oxygen", "xray"],
    "required_specialists": [],
    "condition_category": "unspecified_emergency",
    "self_care_advice": [],
}


# ---------------------------------------------------------------------------
# Pre-cached results for common emergencies (demo fallback)
# If Claude's API is slow or down during the demo, serve these instantly.
# ---------------------------------------------------------------------------

CACHED_TRIAGE = {
    "head_injury": {
        "urgency": "critical",
        "required_beds": ["icu"],
        "required_equipment": ["ct_scanner", "blood_bank", "ventilators", "oxygen"],
        "required_specialists": ["neurosurgeon", "intensivist"],
        "condition_category": "traumatic_brain_injury",
        "self_care_advice": [],
    },
    "cardiac": {
        "urgency": "critical",
        "required_beds": ["icu"],
        "required_equipment": ["ventilators", "oxygen", "lab"],
        "required_specialists": ["cardiologist", "intensivist"],
        "condition_category": "cardiac_emergency",
        "self_care_advice": [],
    },
    "pregnancy": {
        "urgency": "high",
        "required_beds": ["maternity"],
        "required_equipment": ["ultrasound", "theatre", "blood_bank", "oxygen"],
        "required_specialists": ["obstetrician", "anesthesiologist"],
        "condition_category": "pregnancy_complication",
        "self_care_advice": [],
    },
    "diabetic": {
        "urgency": "high",
        "required_beds": ["icu", "emergency"],
        "required_equipment": ["lab", "oxygen"],
        "required_specialists": ["endocrinologist", "intensivist"],
        "condition_category": "diabetic_emergency",
        "self_care_advice": [],
    },
    "child_fever": {
        "urgency": "medium",
        "required_beds": ["pediatric", "emergency"],
        "required_equipment": ["lab", "oxygen", "xray"],
        "required_specialists": ["pediatrician"],
        "condition_category": "pediatric_febrile_illness",
        "self_care_advice": [],
    },
    "headache": {
        "urgency": "low",
        "required_beds": [],
        "required_equipment": [],
        "required_specialists": [],
        "condition_category": "mild_headache",
        "self_care_advice": [
            "Rest in a quiet, dark room and stay hydrated.",
            "Take over-the-counter pain relief such as paracetamol (follow dosage instructions).",
            "If symptoms worsen, seek medical attention immediately.",
        ],
    },
    "cold_flu": {
        "urgency": "low",
        "required_beds": [],
        "required_equipment": [],
        "required_specialists": [],
        "condition_category": "common_cold_or_flu",
        "self_care_advice": [
            "Rest, drink plenty of fluids, and eat light meals.",
            "Take paracetamol for fever or body aches. Use warm salt water to gargle for a sore throat.",
            "If symptoms worsen, seek medical attention immediately.",
        ],
    },
    "stomach_ache": {
        "urgency": "low",
        "required_beds": [],
        "required_equipment": [],
        "required_specialists": [],
        "condition_category": "mild_stomach_discomfort",
        "self_care_advice": [
            "Avoid heavy or spicy food. Drink water or oral rehydration solution (ORS).",
            "Rest and monitor symptoms. A pharmacy can recommend over-the-counter relief.",
            "If symptoms worsen, seek medical attention immediately.",
        ],
    },
}


def _check_cache(description: str) -> dict | None:
    """Check if description matches a cached triage result."""
    desc_lower = description.lower()

    if any(w in desc_lower for w in ("head", "skull", "fell", "ladder", "hit his head", "not responding")):
        if any(w in desc_lower for w in ("fell", "hit", "injury", "bleeding", "accident", "crash")):
            return CACHED_TRIAGE["head_injury"]

    if any(w in desc_lower for w in ("chest pain", "heart", "cardiac", "heart attack")):
        return CACHED_TRIAGE["cardiac"]

    if any(w in desc_lower for w in ("pregnant", "pregnancy", "labor", "labour", "contractions", "water broke", "bleeding pregnant")):
        return CACHED_TRIAGE["pregnancy"]

    if any(w in desc_lower for w in ("diabetic", "diabetes", "sugar", "insulin", "collapsed diabetic")):
        return CACHED_TRIAGE["diabetic"]

    if any(w in desc_lower for w in ("child", "baby", "kid", "son", "daughter", "toddler")):
        if any(w in desc_lower for w in ("fever", "hot", "temperature", "vomiting", "convulsion")):
            return CACHED_TRIAGE["child_fever"]

    # Low-urgency matches
    if any(w in desc_lower for w in ("headache", "head ache", "migraine", "mild headache")):
        if not any(w in desc_lower for w in ("severe", "worst", "blinding", "vomiting", "collapsed")):
            return CACHED_TRIAGE["headache"]

    if any(w in desc_lower for w in ("cold", "flu", "cough", "sore throat", "runny nose", "sneezing", "blocked nose")):
        if not any(w in desc_lower for w in ("breathing", "can't breathe", "wheezing", "severe")):
            return CACHED_TRIAGE["cold_flu"]

    if any(w in desc_lower for w in ("stomach ache", "stomach pain", "belly", "diarrhea", "diarrhoea", "indigestion", "nausea")):
        if not any(w in desc_lower for w in ("severe", "blood", "vomiting blood", "collapsed", "pregnant")):
            return CACHED_TRIAGE["stomach_ache"]

    return None


# ---------------------------------------------------------------------------
# Main function
# ---------------------------------------------------------------------------

async def parse_emergency(description: str) -> dict:
    """
    Parse a natural language emergency description into structured
    medical requirements using Claude.

    Args:
        description: Free text like "my father collapsed, he's diabetic"

    Returns:
        Dict with urgency, required_beds, required_equipment,
        required_specialists, and condition_category.

    Never raises — always returns a valid result (falls back to safe default).
    """

    # Try cache first (instant, no API call)
    cached = _check_cache(description)
    if cached:
        print(f"🧠 TRIAGE (cached): {cached['condition_category']}")
        return cached

    # Call Claude
    try:
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=500,
            system=TRIAGE_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": description}],
        )

        text = message.content[0].text

        # Strip markdown fences if Claude wrapped the JSON
        text = text.strip()
        if text.startswith("```"):
            text = text.removeprefix("```json").removeprefix("```")
        if text.endswith("```"):
            text = text.removesuffix("```")
        text = text.strip()

        result = json.loads(text)

        # Validate required fields exist
        required_fields = ["urgency", "required_beds", "required_equipment",
                          "required_specialists", "condition_category"]
        for field in required_fields:
            if field not in result:
                print(f"⚠️ TRIAGE: Missing field '{field}', using default")
                return SAFE_DEFAULT

        print(f"🧠 TRIAGE (Claude): {result['condition_category']} — urgency: {result['urgency']}")
        return result

    except json.JSONDecodeError as e:
        print(f"⚠️ TRIAGE: Claude returned invalid JSON: {e}")
        print(f"   Raw response: {text[:200]}")
        return SAFE_DEFAULT

    except anthropic.APIError as e:
        print(f"❌ TRIAGE: Claude API error: {e}")
        # Fall back to cache as last resort
        cached = _check_cache(description)
        if cached:
            print(f"   Falling back to cache: {cached['condition_category']}")
            return cached
        return SAFE_DEFAULT

    except Exception as e:
        print(f"❌ TRIAGE: Unexpected error: {e}")
        return SAFE_DEFAULT