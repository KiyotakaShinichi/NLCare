"""The deep-learning benchmark decomposition preserves every metric.

`deep_learning_candidate_benchmark` was split along the lines an ML project is
usually read: the input contract (`_features`), the four architectures
(`_models`), and the rules that turn metrics into a verdict (`_reporting`),
with the training and evaluation harness left where it was.

Reading a move diff carefully is not evidence that behaviour survived it. This
loads the module exactly as it was at `REFERENCE_COMMIT`, straight from git,
runs it and the current module on the same fixture with the same seed, and
compares the two payloads after removing only run-specific fields: the
timestamp, and the paths that embed each run's own temporary directory.

Two pristine runs of the pre-split module were first confirmed to agree on
every metric, so a difference here is the decomposition, not noise.

This needs full git history, which the fresh-clone job checks out. When the
object is missing the loader raises rather than quietly passing: an equivalence
check that silently stops running, in the one job that runs every test file, is
worse than a loud failure.
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

import pandas as pd

from backend.services import deep_learning_candidate_benchmark as benchmark

ROOT = Path(__file__).resolve().parents[1]
REFERENCE_COMMIT = "b3bdfabf1cc72eb5a184829eb456555d46e49784"
MODULE_PATH = "backend/services/deep_learning_candidate_benchmark.py"
RUN_SPECIFIC = frozenset({"generated_at", "source_csv", "artifact_path"})


def _load_reference(tmp_path: Path):
    source = subprocess.run(
        ["git", "show", f"{REFERENCE_COMMIT}:{MODULE_PATH}"],
        cwd=ROOT, capture_output=True, check=True,
    ).stdout
    path = tmp_path / "_dl_benchmark_pre_split.py"
    path.write_bytes(source)
    name = "_dl_benchmark_pre_split"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    # Registered because a dataclass with postponed annotations resolves its
    # module through sys.modules while the class body executes.
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    finally:
        sys.modules.pop(name, None)
    return module


def _strip(value):
    if isinstance(value, dict):
        return {k: _strip(v) for k, v in value.items() if k not in RUN_SPECIFIC}
    if isinstance(value, list):
        return [_strip(v) for v in value]
    return value


def _fixture_csv(path: Path) -> Path:
    rows = []
    subtypes = ["HR+/HER2-", "HER2+", "triple-negative", "HR+/HER2+"]
    stages = ["IIA", "IIB", "IIIA", "IV"]
    regimens = ["AC-T", "TCHP", "carboplatin/paclitaxel", "endocrine therapy"]
    for patient_idx in range(48):
        label = int(patient_idx % 2 == 0)
        for cycle in range(1, 7):
            response = (12 + cycle * 11 + patient_idx % 4) if label else (8 + cycle * 3 + patient_idx % 5)
            rows.append({
                "patient_id": f"DLTEST-{patient_idx:03d}", "cycle": cycle,
                "treatment_date": f"2026-01-{cycle:02d}", "age": 38 + patient_idx % 30,
                "stage": stages[patient_idx % 4], "molecular_subtype": subtypes[patient_idx % 4],
                "regimen": regimens[patient_idx % 4],
                "pre_wbc": 6.0 - cycle * 0.12, "pre_anc": 3.2 - cycle * 0.08,
                "pre_hemoglobin": 12.4 - cycle * 0.07, "pre_platelets": 250 - cycle,
                "nadir_wbc": 3.4 - cycle * 0.12, "nadir_anc": 1.7 - cycle * 0.08,
                "nadir_hemoglobin": 11.7 - cycle * 0.06, "nadir_platelets": 190 - cycle,
                "recovery_wbc": 5.2 - cycle * 0.05, "recovery_hemoglobin": 12.0 - cycle * 0.04,
                "recovery_platelets": 230 - cycle, "mri_tumor_size_cm": 5.0 - response * 0.03,
                "mri_percent_change_from_baseline": -response, "response_score_percent": response,
                "max_symptom_severity": 3 + (cycle % 3), "symptom_count": cycle % 4,
                "intervention_count": int(cycle == 4 and not label),
                "dose_delayed": int(cycle == 5 and not label), "dose_reduced": 0,
                "latent_response_strength": response / 100, "toxicity_risk_binary": 0,
                "urgent_intervention_needed": 0, "support_intervention_needed": 0,
                "cycle_response_trend_class": "partial_response" if label else "stable",
                "final_response_category": "complete_response_signal" if label else "stable_disease",
                "final_cancer_status": "no_evidence_of_disease" if label else "active_disease_needs_review",
                "treatment_success_binary": label, "maintenance_needed": 1,
                "final_response_multiclass": "complete_response_signal" if label else "stable_disease",
            })
    pd.DataFrame(rows).to_csv(path, index=False)
    return path


def test_the_decomposed_benchmark_matches_the_pre_split_module(tmp_path: Path) -> None:
    source = str(_fixture_csv(tmp_path / "rows.csv"))
    reference = _load_reference(tmp_path).run_deep_learning_candidate_benchmark(
        source_csv=source, output_path=str(tmp_path / "reference.json"),
        model_dir=str(tmp_path / "reference_models"), epochs=1, seed=11,
    )
    current = benchmark.run_deep_learning_candidate_benchmark(
        source_csv=source, output_path=str(tmp_path / "current.json"),
        model_dir=str(tmp_path / "current_models"), epochs=1, seed=11,
    )
    assert _strip(current) == _strip(reference)


def test_the_benchmark_module_keeps_its_public_surface() -> None:
    """The script imports these; the feature constants were public before the split."""
    for name in (
        "run_deep_learning_candidate_benchmark",
        "DEFAULT_OUTPUT_PATH",
        "BASE_NUMERIC_FEATURES",
        "CATEGORICAL_FEATURES",
        "SYNTHETIC_GENETIC_FEATURES",
        "SYNTHETIC_TREATMENT_FEATURES",
    ):
        assert hasattr(benchmark, name), f"{name} is no longer importable from the benchmark module"


def test_each_split_module_holds_what_it_claims() -> None:
    from backend.services import (
        deep_learning_candidate_features as features,
        deep_learning_candidate_models as models,
        deep_learning_candidate_reporting as reporting,
    )

    factories = models._model_factories(input_dim=4, hidden_size=8, seq_len=3)
    assert set(factories) == {"sequence_mlp", "temporal_cnn", "bidirectional_gru", "tiny_transformer"}
    assert features.SYNTHETIC_GENETIC_FEATURES and features.SYNTHETIC_TREATMENT_FEATURES
    assert "torch" not in vars(reporting), "reporting is meant to be pure functions over results"
