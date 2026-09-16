"""Every model the runtime can load is named in the operating-modes document.

A model that is fetched at runtime but documented nowhere is the gap this
guards. `sentence-transformers/all-MiniLM-L6-v2` was exactly that: dense hybrid
retrieval is the default configuration, the first index build or query loads it
from the Hugging Face hub, no provisioning step fetches it, and neither the
README nor the environment documentation mentioned it - both claimed everything
after bootstrap runs offline.

The offline command in the document is pinned to the CI job that runs it, so a
change to one cannot silently leave the other stale.
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "docs/environment_configuration.md"
README = ROOT / "README.md"
WORKFLOW = ROOT / ".github/workflows/ci.yml"


def _doc() -> str:
    return DOC.read_text(encoding="utf-8")


def _offline_smoke_suites() -> set[str]:
    workflow = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8").replace("\r\n", "\n"))
    runs = "\n".join(
        str(step.get("run") or "") for step in workflow["jobs"]["offline-smoke"]["steps"]
    )
    return set(re.findall(r"tests/test_[a-z0-9_]+\.py", runs))


def test_the_safety_encoder_is_documented() -> None:
    encoders = set()
    for config in sorted(ROOT.glob("config/dep001*_semantic_safety.yaml")):
        loaded = yaml.safe_load(config.read_text(encoding="utf-8"))
        if isinstance(loaded, dict) and loaded.get("base_encoder"):
            encoders.add(str(loaded["base_encoder"]))
    assert encoders, "no base_encoder is declared in the DEP-001 safety configs"
    missing = sorted(model for model in encoders if model not in _doc())
    assert not missing, f"safety encoders absent from {DOC.name}: {missing}"


def test_the_dense_retrieval_encoder_is_documented() -> None:
    """It is loaded without local_files_only, so it can be fetched at runtime."""
    from backend.services.rag_vector_index import _DENSE_ENCODER_MODEL

    assert _DENSE_ENCODER_MODEL in _doc(), (
        f"{_DENSE_ENCODER_MODEL} can be downloaded at runtime but is not documented "
        f"in {DOC.name}"
    )


def test_the_documented_offline_suites_match_the_ci_job() -> None:
    suites = _offline_smoke_suites()
    assert suites, "the offline-smoke job runs no test files"
    missing = sorted(suite for suite in suites if suite not in _doc())
    assert not missing, f"offline-smoke suites missing from {DOC.name}: {missing}"


def test_the_readme_no_longer_claims_the_default_path_is_offline() -> None:
    """The claim was false: the default index build fetches a retrieval model."""
    assert "everything after that runs offline" not in README.read_text(encoding="utf-8")


def test_the_document_states_which_model_is_provisioned() -> None:
    document = _doc()
    assert "provision_semantic_safety_encoders.py" in document
    assert "RAG_FORCE_SPARSE" in document
