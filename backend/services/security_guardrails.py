import base64
import binascii
import re
import unicodedata

from backend.services.local_llm import assess_security_with_local_llm
from backend.services.unsafe_intent_semantic_classifier import classify_unsafe_intent

# The phrase corpora live in their own module; see security_guardrail_phrases.
# Imported rather than re-declared so `from backend.services.security_guardrails
# import PROMPT_CONTROL_PHRASES` keeps working exactly as before the split.
from backend.services.security_guardrail_phrases import (
    LEET_TRANSLATION,
    PROMPT_CONTROL_PHRASES,
    TAGALOG_ATTACK_PHRASES,
    MULTILINGUAL_ATTACK_PHRASES,
    SENSITIVE_TARGET_TERMS,
    EXFILTRATION_VERBS,
    URGENT_MEDICAL_PHRASES,
    SQL_OR_FILE_PATTERNS,
    RAW_SQL_INJECTION_PATTERNS,
    FILESYSTEM_ATTACK_PHRASES,
    CROSS_PATIENT_ID_PATTERN,
)


def detect_prompt_injection_or_exfiltration(text):
    normalized = normalize_security_text(text)
    variants = [normalized] + [normalize_security_text(item) for item in _decoded_variants(text)]
    issues = []
    signals = []
    semantic = classify_unsafe_intent(text)
    safe_boundary_request = (
        semantic.get("family") == "none"
        and not bool(semantic.get("is_unsafe"))
        and semantic.get("safety_source") == "safe_boundary_request"
    )

    phrase_groups = [
        ("prompt_injection_or_jailbreak", PROMPT_CONTROL_PHRASES),
        ("prompt_injection_or_jailbreak", TAGALOG_ATTACK_PHRASES),
        ("prompt_injection_or_jailbreak", MULTILINGUAL_ATTACK_PHRASES),
    ]
    if not safe_boundary_request:
        for category, phrases in phrase_groups:
            matches = []
            for variant in variants:
                matches.extend(_phrase_matches(variant, variant.replace(" ", ""), phrases))
            if matches:
                issues.append(category)
                signals.extend({"category": category, "match": match} for match in sorted(set(matches))[:5])

    sql_matches = []
    for pattern in SQL_OR_FILE_PATTERNS:
        if any(re.search(pattern, variant) for variant in variants):
            sql_matches.append(pattern)
    # Scan the raw lowercased text as well — normalize_security_text strips
    # SQL-syntax punctuation (* ; --), so the normalized variant alone misses
    # "SELECT * FROM patients; --" style payloads.
    raw_lower = str(text or "").lower()
    for pattern in RAW_SQL_INJECTION_PATTERNS:
        if re.search(pattern, raw_lower):
            sql_matches.append(pattern)
    if sql_matches:
        issues.append("database_or_file_access_attempt")
        signals.extend({"category": "database_or_file_access_attempt", "match": match} for match in sql_matches[:5])

    # Filesystem-listing attacks like "list every file in /Data and paste the
    # contents here" — composite phrases avoid benign-query false positives.
    fs_matches = []
    for phrase in FILESYSTEM_ATTACK_PHRASES:
        if any(phrase in variant for variant in variants) or phrase in raw_lower:
            fs_matches.append(phrase)
    if fs_matches:
        issues.append("database_or_file_access_attempt")
        signals.extend(
            {"category": "database_or_file_access_attempt", "match": match}
            for match in fs_matches[:5]
        )

    if (
        not safe_boundary_request
        and any(_has_exfiltration_intent(variant) for variant in variants)
    ):
        issues.append("sensitive_data_exfiltration_attempt")
        signals.append({"category": "sensitive_data_exfiltration_attempt", "match": "verb+protected_target"})

    if (
        not safe_boundary_request
        and any(_asks_for_other_patient(variant) for variant in variants)
    ):
        issues.append("privacy_boundary_request")
        signals.append({"category": "privacy_boundary_request", "match": "other/all patient data"})

    # Cross-patient ID lookups: "patient P-12345's labs", "patient 12345 records".
    # Scanned against the raw lowercase text because normalize_security_text
    # leet-translates digits (1→i, 3→e, 4→a, 5→s) so the patient ID number
    # never survives normalization. The raw text keeps the digits intact.
    if re.search(CROSS_PATIENT_ID_PATTERN, raw_lower):
        issues.append("privacy_boundary_request")
        signals.append({"category": "privacy_boundary_request", "match": "patient_id_lookup"})

    if (
        semantic.get("family") in {"privacy_pii", "prompt_injection", "cross_patient_exfiltration"}
        and float(semantic.get("confidence") or 0.0) >= 0.62
        and not _is_obvious_low_risk_support_or_education(normalized)
    ):
        issue = (
            "privacy_boundary_request"
            if semantic["family"] in {"privacy_pii", "cross_patient_exfiltration"}
            else "prompt_injection_or_jailbreak"
        )
        issues.append(issue)
        signals.append({
            "category": "semantic_unsafe_intent_classifier",
            "match": semantic["family"],
            "confidence": semantic.get("confidence"),
            "over_refusal_risk_flag": semantic.get("over_refusal_risk_flag"),
        })

    medical = detect_multilingual_medical_danger(text)
    if medical["detected"]:
        issues.append("urgent_medical_or_self_harm")
        signals.extend({"category": "urgent_medical_or_self_harm", "match": item} for item in medical["matches"][:5])

    benign_self_entry = not issues and (
        _is_benign_self_data_entry(normalized)
        or _is_benign_self_memory_query(normalized)
    )
    obvious_low_risk = not issues and _is_obvious_low_risk_support_or_education(normalized)
    should_ask_llm = bool(issues) or (
        not safe_boundary_request and not obvious_low_risk
    )
    llm_assessment = (
        assess_security_with_local_llm(
            text,
            deterministic_context={"issues": sorted(set(issues)), "signals": signals[:10]},
        )
        if should_ask_llm
        else {
            "available": False,
            "reason": "skipped_for_obvious_low_risk_support_or_education",
        }
    )
    llm_wants_block = (
        llm_assessment.get("available")
        and llm_assessment.get("blocked")
        and float(llm_assessment.get("confidence") or 0) >= 0.7
    )
    llm_confidence = float(llm_assessment.get("confidence") or 0)
    llm_can_block_without_deterministic_issue = (
        _has_security_or_privacy_anchor(normalized)
        or llm_confidence >= 0.95
    )
    if (
        llm_wants_block
        and not benign_self_entry
        and not obvious_low_risk
        and (issues or llm_can_block_without_deterministic_issue)
    ):
        issues.extend(str(issue) for issue in llm_assessment.get("issues") or ["llm_security_boundary"])
        signals.append({
            "category": "local_llm_security_assessment",
            "match": llm_assessment.get("reason") or "blocked",
            "confidence": llm_assessment.get("confidence"),
        })
    elif llm_wants_block and (benign_self_entry or obvious_low_risk):
        signals.append({
            "category": "llm_security_assessment_suppressed",
            "match": "benign self-scoped or low-risk support/education wording",
            "confidence": llm_assessment.get("confidence"),
        })

    issues = sorted(set(issues))
    blocked = bool(issues)
    return {
        "blocked": blocked,
        "status": "failed" if blocked else "passed",
        "issues": issues,
        "signals": signals[:10],
        "confidence": _confidence(issues, signals),
        "llm_assessment": llm_assessment,
        "semantic_unsafe_intent": semantic,
        "medical_danger": medical,
        "normalized_text": normalized[:500],
        "message": (
            "Security guardrail blocked suspected prompt-injection, jailbreak, privacy-boundary, data-exfiltration, or urgent danger intent."
            if blocked else "Security guardrail passed."
        ),
    }


def normalize_security_text(text):
    value = unicodedata.normalize("NFKC", str(text or ""))
    value = "".join(char for char in value if unicodedata.category(char) not in {"Cf", "Cc"})
    value = _strip_diacritics(value).lower().translate(LEET_TRANSLATION)
    value = re.sub(r"[\u200b-\u200f\u202a-\u202e]", "", value)
    value = re.sub(r"[_\-./\\|*~`'\"()\[\]{}:;,+?<>]+", " ", value)
    value = re.sub(r"(.)\1{3,}", r"\1\1", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def detect_multilingual_medical_danger(text):
    normalized = normalize_security_text(text)
    compact = normalized.replace(" ", "")
    matches = []
    for phrase in URGENT_MEDICAL_PHRASES:
        clean = normalize_security_text(phrase)
        if clean and (clean in normalized or clean.replace(" ", "") in compact):
            matches.append(phrase)
    return {
        "detected": bool(matches),
        "matches": sorted(set(matches))[:10],
    }


def _phrase_matches(normalized, compact, phrases):
    matches = []
    for phrase in phrases:
        clean = normalize_security_text(phrase)
        if clean and (clean in normalized or clean.replace(" ", "") in compact):
            matches.append(phrase)
    return matches


def _has_exfiltration_intent(normalized):
    has_verb = any(_term_present(normalized, verb) for verb in EXFILTRATION_VERBS)
    has_target = any(_term_present(normalized, target) for target in SENSITIVE_TARGET_TERMS)
    return has_verb and has_target


def _asks_for_other_patient(normalized):
    patient_scope_terms = [
        "all patients",
        "other patient",
        "another patient",
        "someone else",
        "results for patient",
        "data for patient",
        "records for patient",
        "ibang pasyente",
        "lahat ng pasyente",
        "lahat ng patient",
        "records ng pasyente",
        "patient records",
        "registros de pacientes",
        "patientendaten",
        "данные пациентов",
        "患者数据",
        "患者記録",
        "환자 기록",
        "سجلات المرضى",
        "मरीजों का डेटा",
    ]
    return any(_term_present(normalized, term) for term in patient_scope_terms)


def _is_benign_self_data_entry(normalized):
    action_terms = [
        "where can i put",
        "where do i put",
        "how do i upload",
        "how can i upload",
        "upload my",
        "put my",
        "save my",
        "log my",
        "record my",
        "report my",
        "add my",
        "enter my",
    ]
    self_data_terms = [
        "my cbc",
        "my lab",
        "my labs",
        "my medication",
        "my medications",
        "my symptom",
        "my symptoms",
        "my mri",
        "my scan",
        "my upload",
    ]
    portal_terms = ["portal", "upload", "uploads", "cbc", "medication", "symptoms", "mri"]
    return (
        any(term in normalized for term in action_terms)
        and any(term in normalized for term in self_data_terms)
        and any(term in normalized for term in portal_terms)
    )


def _is_benign_self_memory_query(normalized):
    memory_terms = [
        "what did i tell you",
        "what did i say",
        "what was my last message",
        "what did i mention",
        "remember what i said",
        "remember what i told you",
        "my chat history",
    ]
    risky_scope_terms = [
        "other patient",
        "another patient",
        "all patients",
        "database",
        "system prompt",
        "developer message",
        "secret",
        "api key",
    ]
    return any(term in normalized for term in memory_terms) and not any(term in normalized for term in risky_scope_terms)


def _is_obvious_low_risk_support_or_education(normalized):
    if _has_security_or_privacy_anchor(normalized):
        return False
    if len(normalized.split()) <= 6 and any(term in normalized for term in [
        "hi",
        "hello",
        "hey",
        "kumusta",
        "kamusta",
        "who are you",
        "how are you",
        "what can you do",
    ]):
        return True
    low_risk_terms = [
        "what is pcr",
        "what does pcr",
        "cbc trends",
        "what is cbc",
        "what do cbc",
        "wbc",
        "hemoglobin",
        "platelets",
        "side effect",
        "breast cancer monitoring",
        "chemotherapy",
        "model signal",
        "nlcare portal",
    ]
    return any(term in normalized for term in low_risk_terms)


def _has_security_or_privacy_anchor(normalized):
    anchor_terms = [
        "ignore",
        "disregard",
        "bypass",
        "override",
        "jailbreak",
        "developer mode",
        "system prompt",
        "developer message",
        "hidden instruction",
        "chain of thought",
        "database",
        "sql",
        "schema",
        "table",
        "other patient",
        "all patients",
        "patient records",
        "patient data",
        "knowledge base",
        "raw documents",
        "api key",
        "secret",
        "token",
        "credentials",
        "wag sundin",
        "huwag sundin",
        "pasyente",
        "ibang pasyente",
        "lahat ng pasyente",
    "base de datos",
    "registros de pacientes",
    "данные другого пациента",
    "другого пациента",
    ]
    return any(_term_present(normalized, term) for term in anchor_terms)


def _term_present(normalized, term):
    clean = normalize_security_text(term)
    if not clean:
        return False
    if " " in clean:
        return clean in normalized
    if _has_word_boundary_script(clean):
        return re.search(rf"\b{re.escape(clean)}\b", normalized) is not None
    return clean in normalized


def _strip_diacritics(value):
    decomposed = unicodedata.normalize("NFKD", value)
    return "".join(char for char in decomposed if not unicodedata.combining(char))


def _decoded_variants(text):
    raw = str(text or "")
    decoded = []
    for candidate in re.findall(r"(?<![A-Za-z0-9+/=])([A-Za-z0-9+/]{16,}={0,2})(?![A-Za-z0-9+/=])", raw)[:3]:
        try:
            padded = candidate + ("=" * ((4 - len(candidate) % 4) % 4))
            value = base64.b64decode(padded, validate=True)
            decoded_text = value.decode("utf-8")
        except (binascii.Error, ValueError, UnicodeDecodeError):
            continue
        if decoded_text and len(decoded_text) <= 2000:
            decoded.append(decoded_text)
    for candidate in re.findall(r"\b(?:[0-9a-fA-F]{2}){8,}\b", raw)[:3]:
        try:
            decoded_text = bytes.fromhex(candidate).decode("utf-8")
        except (ValueError, UnicodeDecodeError):
            continue
        if decoded_text and len(decoded_text) <= 2000:
            decoded.append(decoded_text)
    return decoded


def _has_word_boundary_script(value):
    return all(ord(char) < 128 for char in value)


def _confidence(issues, signals):
    if not issues:
        return 0.0
    score = 0.55 + min(0.4, 0.1 * len(issues)) + min(0.05, 0.01 * len(signals))
    return round(min(score, 0.99), 3)
