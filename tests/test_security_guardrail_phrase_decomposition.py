"""Moving the guardrail vocabulary out of the detector changed no verdict.

`security_guardrails` carried several hundred lines of attack-phrase corpora
ahead of the detection logic. The two halves are read for different reasons - a
new Tagalog exfiltration phrasing is a language judgement, a change to the
base64 variant handling is a code review - so the lexicon now lives in
`security_guardrail_phrases` and the detector imports it back.

Reading the move diff is not evidence that behaviour survived it, and this is
safety code: a silently dropped phrase would weaken a guardrail while every
existing test still passed. So this loads the pre-split module exactly as it was
at `REFERENCE_COMMIT`, straight from git, and replays the committed adversarial
bank through both modules, comparing the full verdict for every case.

The bank is read-only protected evidence; nothing here regenerates it.

Full git history is required, which the fresh-clone job checks out. When the
object is missing the loader raises rather than quietly passing: an equivalence
check that stops running is worse than one that fails loudly.
"""

from __future__ import annotations

import ast
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

from backend.services import security_guardrails
from backend.services import security_guardrail_phrases

ROOT = Path(__file__).resolve().parents[1]
REFERENCE_COMMIT = "3f59beee99819a2d22a0938690e0b923593e4e5a"
MODULE_PATH = "backend/services/security_guardrails.py"
BANK = ROOT / "Data/evals/safety/adversarial_safety_regression_bank.jsonl"
MAX_LOC = 500

PHRASE_NAMES = (
    "LEET_TRANSLATION",
    "PROMPT_CONTROL_PHRASES",
    "TAGALOG_ATTACK_PHRASES",
    "MULTILINGUAL_ATTACK_PHRASES",
    "SENSITIVE_TARGET_TERMS",
    "EXFILTRATION_VERBS",
    "URGENT_MEDICAL_PHRASES",
    "SQL_OR_FILE_PATTERNS",
    "RAW_SQL_INJECTION_PATTERNS",
    "FILESYSTEM_ATTACK_PHRASES",
    "CROSS_PATIENT_ID_PATTERN",
)


@pytest.fixture(scope="module")
def reference_module(tmp_path_factory):
    source = subprocess.run(
        ["git", "show", f"{REFERENCE_COMMIT}:{MODULE_PATH}"],
        cwd=ROOT, capture_output=True, check=True,
    ).stdout
    path = tmp_path_factory.mktemp("presplit") / "_guardrails_pre_split.py"
    path.write_bytes(source)
    name = "_guardrails_pre_split"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    finally:
        sys.modules.pop(name, None)
    return module


def _bank_queries() -> list[str]:
    rows = [
        json.loads(line)
        for line in BANK.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    queries = [str(row["query"]) for row in rows if row.get("query")]
    assert len(queries) >= 200, f"the adversarial bank shrank to {len(queries)} cases"
    return queries


def test_the_pre_split_module_really_carried_the_vocabulary(reference_module) -> None:
    """Guards the guard: if the reference had no corpora, equivalence is vacuous."""
    for name in PHRASE_NAMES:
        assert hasattr(reference_module, name), f"{name} was not in the pre-split module"


def test_every_phrase_corpus_survived_the_move_byte_for_byte(reference_module) -> None:
    for name in PHRASE_NAMES:
        assert getattr(security_guardrail_phrases, name) == getattr(reference_module, name), (
            f"{name} differs from the pre-split module; a phrase was dropped or altered"
        )


def test_the_detector_still_exposes_every_corpus(reference_module) -> None:
    """Existing imports name these through `security_guardrails`."""
    for name in PHRASE_NAMES:
        assert getattr(security_guardrails, name) == getattr(reference_module, name)


def test_no_verdict_changed_across_the_adversarial_bank(reference_module) -> None:
    for query in _bank_queries():
        assert security_guardrails.detect_prompt_injection_or_exfiltration(query) == (
            reference_module.detect_prompt_injection_or_exfiltration(query)
        ), f"injection verdict changed for: {query[:80]!r}"


def test_no_medical_danger_verdict_changed_across_the_bank(reference_module) -> None:
    for query in _bank_queries():
        assert security_guardrails.detect_multilingual_medical_danger(query) == (
            reference_module.detect_multilingual_medical_danger(query)
        ), f"medical-danger verdict changed for: {query[:80]!r}"


def test_normalisation_is_unchanged(reference_module) -> None:
    """Leetspeak and diacritic folding feed every matcher above."""
    for query in _bank_queries():
        assert security_guardrails.normalize_security_text(query) == (
            reference_module.normalize_security_text(query)
        )


def test_the_lexicon_holds_no_logic() -> None:
    """A data module that grows behaviour stops being reviewable as a wordlist."""
    path = ROOT / "backend/services/security_guardrail_phrases.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    offenders = [
        type(node).__name__
        for node in tree.body
        if not isinstance(node, (ast.Assign, ast.AnnAssign, ast.Expr))
    ]
    assert not offenders, f"the phrase lexicon contains logic: {offenders}"


def test_both_halves_are_under_the_size_limit() -> None:
    """The point of the split: neither half is a file nobody can hold in mind."""
    for relative in ("backend/services/security_guardrails.py",
                     "backend/services/security_guardrail_phrases.py"):
        count = len((ROOT / relative).read_text(encoding="utf-8").splitlines())
        assert count <= MAX_LOC, f"{relative} is {count} lines, over the {MAX_LOC} limit"
