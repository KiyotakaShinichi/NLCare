"""The DEP-001B freeze identifies the evaluated candidate - and main has moved on.

`candidate_freeze_manifest.json` hash-binds 26 artifacts, recorded on
2026-08-13 before the internal blind run. The recorded integrity incident
accounts for exactly one later mismatch, `latest_overlap_audit.json`, written by
a timed-out test fixture. Nine further source and configuration files have
changed since, so for those files the code on `main` is not the code that was
evaluated.

That is disclosed here, not repaired. The manifest and the incident record are
protected evidence, the blind run is consumed, and re-freezing is refused by
design once a blind receipt exists. What this file does is keep the drift
explicit and stop it from growing without anyone noticing:

* the drifted set must equal the disclosed set, so a change to a frozen
  artifact that still matches fails here until it is disclosed;
* the blind inputs - the four banks and the model, calibration, and threshold
  artifacts - must still match the freeze;
* the disclosure document must name every drifted path.

Digests are compared in every line-ending form of the on-disk bytes. The
manifest recorded bytes as they were on disk, and a Windows checkout converts
text files, so a raw comparison would report checkout convention as drift.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "Data/evals/safety/dep001b/candidate_freeze_manifest.json"
INCIDENT = ROOT / "Data/evals/safety/dep001b/latest_freeze_integrity_incident.json"
DISCLOSURE = ROOT / "docs/dep001_safety_release_architecture.md"

RECORDED_INCIDENT = frozenset({"Data/evals/safety/dep001b/latest_overlap_audit.json"})

POST_INCIDENT_DRIFT = frozenset({
    "config/release_gate_thresholds.yaml",
    "backend/services/safety_policy_action.py",
    "backend/services/dep001b_semantic_safety.py",
    "backend/services/dep001b_safety_corpus.py",
    "backend/services/dep001b_safety_evaluation.py",
    "backend/services/agent_safety.py",
    "backend/services/agent_intent_router.py",
    "backend/services/agent_rag.py",
    "backend/services/post_generation_validator.py",
})

DISCLOSED_DRIFT = RECORDED_INCIDENT | POST_INCIDENT_DRIFT

BLIND_INPUTS = frozenset({
    "Data/evals/safety/dep001b/train_safety_bank.jsonl",
    "Data/evals/safety/dep001b/validation_safety_bank.jsonl",
    "Data/evals/safety/dep001b/internal_test_safety_bank.jsonl",
    "Data/evals/safety/dep001b/internal_blind_safety_bank.jsonl",
    "Data/evals/safety/dep001b/semantic_safety_model.joblib",
    "Data/evals/safety/dep001b/semantic_safety_calibration.joblib",
    "Data/evals/safety/dep001b/semantic_safety_thresholds.json",
    "Data/evals/safety/dep001b/semantic_safety_model_manifest.json",
})


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _forms(path: Path) -> set[str]:
    data = path.read_bytes()
    lf = data.replace(b"\r\n", b"\n")
    return {_sha(data), _sha(lf), _sha(lf.replace(b"\n", b"\r\n"))}


def _frozen() -> dict[str, dict]:
    return dict(json.loads(MANIFEST.read_text(encoding="utf-8"))["frozen_artifacts"])


def _drifted() -> set[str]:
    return {
        relative
        for relative, record in _frozen().items()
        if not (ROOT / relative).is_file() or record["sha256"] not in _forms(ROOT / relative)
    }


def test_the_drift_is_exactly_the_disclosed_set() -> None:
    drifted = _drifted()
    new = sorted(drifted - DISCLOSED_DRIFT)
    restored = sorted(DISCLOSED_DRIFT - drifted)
    assert not new, (
        f"frozen DEP-001B artifacts changed without disclosure: {new}. Disclose "
        "the change in docs/dep001_safety_release_architecture.md and add it to "
        "POST_INCIDENT_DRIFT; do not rewrite the freeze manifest"
    )
    assert not restored, f"disclosed drift no longer drifts, update the disclosure: {restored}"


def test_the_blind_inputs_still_match_the_freeze() -> None:
    assert BLIND_INPUTS <= set(_frozen()), "a blind input is no longer in the freeze manifest"
    assert not (BLIND_INPUTS & _drifted()), (
        f"a frozen blind input changed: {sorted(BLIND_INPUTS & _drifted())}"
    )


def test_the_recorded_incident_accounts_for_exactly_its_one_mismatch() -> None:
    incident = json.loads(INCIDENT.read_text(encoding="utf-8"))
    assert frozenset(incident["integrity"]["mismatching_paths"]) == RECORDED_INCIDENT
    assert incident["integrity"]["mismatching_frozen_artifact_count_after_run"] == 1


def test_the_post_incident_drift_is_not_covered_by_the_incident_record() -> None:
    """Why the disclosure document exists: the incident record predates this drift."""
    assert not (POST_INCIDENT_DRIFT & RECORDED_INCIDENT)


def test_every_drifted_path_is_named_in_the_disclosure() -> None:
    text = DISCLOSURE.read_text(encoding="utf-8")
    missing = sorted(path for path in DISCLOSED_DRIFT if f"`{path}`" not in text)
    assert not missing, f"drifted paths not disclosed in {DISCLOSURE.name}: {missing}"
