"""Model selection, context comparison, and status for the DL benchmark.

Pure functions over the results dictionary the benchmark has already computed:
which model is best overall and per task, what the genetic and treatment
contexts changed, and the benchmark's status label. Nothing here trains or
evaluates a model. Split out of ``deep_learning_candidate_benchmark`` so the
rules that turn metrics into a verdict are reviewable on their own.
"""
from __future__ import annotations

from typing import Any



def _recommended_role(group_name: str) -> str:
    return {
        "imaging_response": "highest direct response-monitoring signal when report timing is valid",
        "cbc_labs": "high toxicity/monitoring signal; response support only",
        "symptoms_interventions": "high review-routing signal; patient-reported and context-dependent",
        "treatment_context": "context and temporal alignment signal",
        "demographics_stage": "baseline context; should not dominate",
        "biomarker_subtype": "contextual modifier for expected treatment pathways",
        "synthetic_genetic_context": "genetic-counselor review and contextual modifier only",
        "synthetic_treatment_context": "treatment-combination context only, never treatment recommendation",
    }.get(group_name, "context")


def _select_best_model(results: dict[str, Any]) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for variant, models in results.items():
        for model_name, metrics in models.items():
            rows.append({
                "variant": variant,
                "model": model_name,
                "artifact_path": metrics["artifact_path"],
                "classification_auroc": metrics["classification"]["auroc"],
                "classification_brier": metrics["classification"]["brier"],
                "regression_mae_percent": metrics["regression"]["mae_percent"],
                "regression_r2": metrics["regression"]["r2"],
            })
    return sorted(
        rows,
        key=lambda row: (
            row["classification_auroc"] or 0.0,
            -(row["classification_brier"] or 1.0),
            -(row["regression_mae_percent"] or 999.0),
        ),
        reverse=True,
    )[0]


def _select_best_models_by_task(results: dict[str, Any]) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for variant, models in results.items():
        for model_name, metrics in models.items():
            rows.append({
                "variant": variant,
                "model": model_name,
                "artifact_path": metrics["artifact_path"],
                "classification_auroc": metrics["classification"]["auroc"],
                "classification_brier": metrics["classification"]["brier"],
                "regression_mae_percent": metrics["regression"]["mae_percent"],
                "regression_r2": metrics["regression"]["r2"],
            })
    return {
        "classification": sorted(
            rows,
            key=lambda row: (
                row["classification_auroc"] or 0.0,
                -(row["classification_brier"] or 1.0),
            ),
            reverse=True,
        )[0],
        "regression": sorted(
            rows,
            key=lambda row: (
                -(row["regression_mae_percent"] or 999.0),
                row["regression_r2"],
            ),
            reverse=True,
        )[0],
    }


def _compare_genetic_context(results: dict[str, Any]) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for model_name, with_metrics in results["with_genetic_context"].items():
        without_metrics = results["without_genetic_context"][model_name]
        rows.append({
            "model": model_name,
            "classification_auroc_delta": _round_or_none(
                (with_metrics["classification"]["auroc"] or 0.0) - (without_metrics["classification"]["auroc"] or 0.0)
            ),
            "classification_brier_delta": _round_or_none(
                with_metrics["classification"]["brier"] - without_metrics["classification"]["brier"]
            ),
            "regression_mae_delta": _round_or_none(
                with_metrics["regression"]["mae_percent"] - without_metrics["regression"]["mae_percent"]
            ),
            "regression_r2_delta": _round_or_none(
                with_metrics["regression"]["r2"] - without_metrics["regression"]["r2"]
            ),
        })
    best_classification_delta = max(row["classification_auroc_delta"] or 0.0 for row in rows)
    best_regression_delta = min(row["regression_mae_delta"] or 0.0 for row in rows)
    return {
        "rows": rows,
        "best_classification_auroc_delta": best_classification_delta,
        "best_regression_mae_delta": best_regression_delta,
        "decision": (
            "context_only_no_promotion"
            if best_classification_delta < 0.01 and best_regression_delta > -1.0
            else "candidate_for_external_validation_only"
        ),
        "interpretation": (
            "Synthetic genetic context can be benchmarked, but any gain must be treated as simulator-specific "
            "until real genetic-test records and external validation exist."
        ),
    }


def _compare_treatment_context(results: dict[str, Any]) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for model_name, with_metrics in results["with_treatment_context"].items():
        without_metrics = results["without_genetic_context"][model_name]
        rows.append({
            "model": model_name,
            "classification_auroc_delta": _round_or_none(
                (with_metrics["classification"]["auroc"] or 0.0) - (without_metrics["classification"]["auroc"] or 0.0)
            ),
            "classification_brier_delta": _round_or_none(
                with_metrics["classification"]["brier"] - without_metrics["classification"]["brier"]
            ),
            "regression_mae_delta": _round_or_none(
                with_metrics["regression"]["mae_percent"] - without_metrics["regression"]["mae_percent"]
            ),
            "regression_r2_delta": _round_or_none(
                with_metrics["regression"]["r2"] - without_metrics["regression"]["r2"]
            ),
        })
    best_classification_delta = max(row["classification_auroc_delta"] or 0.0 for row in rows)
    best_regression_delta = min(row["regression_mae_delta"] or 0.0 for row in rows)
    return {
        "rows": rows,
        "best_classification_auroc_delta": best_classification_delta,
        "best_regression_mae_delta": best_regression_delta,
        "decision": "context_only_no_treatment_recommendation",
        "interpretation": (
            "Synthetic treatment-combination features can improve or stabilize offline signals, but they encode "
            "treatment context only. They must not be used to recommend a regimen or compare real-world efficacy."
        ),
    }


def _status(results: dict[str, Any], comparison: dict[str, Any]) -> str:
    best_auroc = max(
        metrics["classification"]["auroc"] or 0.0
        for models in results.values()
        for metrics in models.values()
    )
    best_r2 = max(
        metrics["regression"]["r2"]
        for models in results.values()
        for metrics in models.values()
    )
    if best_auroc >= 0.85 and best_r2 >= 0.5 and comparison["decision"] in {"context_only_no_promotion", "candidate_for_external_validation_only"}:
        return "strong"
    if best_auroc >= 0.75 and best_r2 >= 0.2:
        return "acceptable"
    return "needs_attention"


def _round_or_none(value: float | None, digits: int = 4) -> float | None:
    if value is None:
        return None
    return round(float(value), digits)
