from __future__ import annotations

import json
import random
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import torch
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    brier_score_loss,
    mean_absolute_error,
    mean_squared_error,
    r2_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

from backend.services.deep_learning_candidate_features import (
    BASE_NUMERIC_FEATURES,
    CATEGORICAL_FEATURES,
    SYNTHETIC_GENETIC_FEATURES,
    SYNTHETIC_TREATMENT_FEATURES,
    _add_synthetic_genetic_context,
    _add_synthetic_treatment_context,
    _feature_groups,
    _features_for_variant,
)
from backend.services.deep_learning_candidate_models import _model_factories
from backend.services.deep_learning_candidate_reporting import (
    _compare_genetic_context,
    _compare_treatment_context,
    _recommended_role,
    _round_or_none,
    _select_best_model,
    _select_best_models_by_task,
    _status,
)


ROOT_DIR = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE_CSV = "Data/complete_synthetic_breast_journeys/temporal_ml_rows.csv"
DEFAULT_OUTPUT_PATH = "Data/evals/models/latest_deep_learning_candidate_benchmark.json"
DEFAULT_MODEL_DIR = "Data/complete_synthetic_training/deep_learning_candidates"


@dataclass(frozen=True)
class TrainingConfig:
    epochs: int = 24
    batch_size: int = 64
    learning_rate: float = 1e-3
    seed: int = 42
    test_size: float = 0.25
    hidden_size: int = 64


def run_deep_learning_candidate_benchmark(
    *,
    source_csv: str = DEFAULT_SOURCE_CSV,
    output_path: str = DEFAULT_OUTPUT_PATH,
    model_dir: str = DEFAULT_MODEL_DIR,
    epochs: int = 24,
    seed: int = 42,
) -> dict[str, Any]:
    config = TrainingConfig(epochs=epochs, seed=seed)
    _seed_everything(seed)

    rows = pd.read_csv(ROOT_DIR / source_csv if not Path(source_csv).is_absolute() else source_csv)
    rows = _add_synthetic_genetic_context(rows, seed=seed)
    rows = _add_synthetic_treatment_context(rows)
    prepared = _prepare_sequences(rows, config=config)

    base_features = [
        f for f in prepared["feature_names"]
        if f not in SYNTHETIC_GENETIC_FEATURES and f not in SYNTHETIC_TREATMENT_FEATURES
    ]
    variants = {
        "without_genetic_context": base_features,
        "with_genetic_context": base_features + SYNTHETIC_GENETIC_FEATURES,
        "with_treatment_context": base_features + SYNTHETIC_TREATMENT_FEATURES,
        "with_genetic_and_treatment_context": prepared["feature_names"],
    }

    results: dict[str, Any] = {}
    model_output_dir = ROOT_DIR / model_dir
    model_output_dir.mkdir(parents=True, exist_ok=True)
    for variant_name, selected_features in variants.items():
        selected_idx = [prepared["feature_names"].index(feature) for feature in selected_features]
        X_train = prepared["X_train"][:, :, selected_idx]
        X_test = prepared["X_test"][:, :, selected_idx]
        variant_results: dict[str, Any] = {}
        for model_name, factory in _model_factories(input_dim=X_train.shape[-1], hidden_size=config.hidden_size, seq_len=X_train.shape[1]).items():
            metrics, state_path = _train_and_evaluate(
                model_name=model_name,
                model_factory=factory,
                X_train=X_train,
                X_test=X_test,
                y_class_train=prepared["y_class_train"],
                y_class_test=prepared["y_class_test"],
                y_reg_train=prepared["y_reg_train"],
                y_reg_test=prepared["y_reg_test"],
                config=config,
                state_path=model_output_dir / f"{variant_name}_{model_name}.pt",
            )
            variant_results[model_name] = {**metrics, "artifact_path": str(state_path)}
        results[variant_name] = variant_results

    best = _select_best_model(results)
    best_by_task = _select_best_models_by_task(results)
    group_importance = _group_permutation_importance(
        best=best,
        prepared=prepared,
        config=config,
        model_path=ROOT_DIR / best["artifact_path"],
    )
    comparison = _compare_genetic_context(results)

    payload: dict[str, Any] = {
        "schema_version": "deep_learning_candidate_benchmark_v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": _status(results, comparison),
        "source_csv": source_csv,
        "patients": int(rows["patient_id"].nunique()),
        "rows": int(len(rows)),
        "sequence_length": int(prepared["X_train"].shape[1]),
        "feature_count": {
            "base_plus_one_hot": len(variants["without_genetic_context"]),
            "with_genetic_context": len(variants["with_genetic_context"]),
            "with_treatment_context": len(variants["with_treatment_context"]),
            "with_genetic_and_treatment_context": len(variants["with_genetic_and_treatment_context"]),
            "synthetic_genetic_context": len(SYNTHETIC_GENETIC_FEATURES),
            "synthetic_treatment_context": len(SYNTHETIC_TREATMENT_FEATURES),
        },
        "targets": {
            "classification": "treatment_success_binary",
            "regression": "final-cycle response_score_percent scaled to 0..1 for training and reported as percent MAE/RMSE",
        },
        "models": results,
        "best_model": best,
        "best_models": best_by_task,
        "genetic_context_ablation": comparison,
        "treatment_context_ablation": _compare_treatment_context(results),
        "predictor_group_importance": group_importance,
        "recommended_weighting_policy": [
            "Highest evidentiary weight: direct longitudinal response evidence such as imaging trend and clinician-reviewed report summaries.",
            "High monitoring weight: CBC/lab trajectory, symptoms, treatment-cycle timing, and dose/intervention events.",
            "Contextual weight: ER/PR/HER2/Ki-67 and known treatment regimen context.",
            "Referral/context weight: germline genetic-test records and family-history readiness; useful for review routing, not standalone response proof.",
            "Lowest standalone weight: tumor-marker trends; review context only, never recurrence/progression proof by themselves.",
        ],
        "genetic_feature_boundary": (
            "Synthetic genetic mutation features are included only as contextual candidate predictors. "
            "They are not inferred from imaging, not interpreted as medical advice, and not promoted "
            "without real genetic-test records plus external validation."
        ),
        "treatment_feature_boundary": (
            "Synthetic treatment-combination features encode regimen/timeline context only. They are not treatment "
            "recommendations, do not compare real treatment efficacy, and cannot be used to tell a patient to start, "
            "stop, delay, or switch therapy."
        ),
        "claim_boundary": (
            "Deep-learning results are synthetic engineering baselines. They measure ability to learn the simulator, "
            "not real patient response, prognosis, genetic risk, or clinical treatment utility."
        ),
    }

    output = ROOT_DIR / output_path
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


def _prepare_sequences(rows: pd.DataFrame, *, config: TrainingConfig) -> dict[str, Any]:
    rows = rows.sort_values(["patient_id", "cycle"]).copy()
    rows[CATEGORICAL_FEATURES] = rows[CATEGORICAL_FEATURES].fillna("unknown").astype(str)
    encoded = pd.get_dummies(rows[CATEGORICAL_FEATURES], prefix=CATEGORICAL_FEATURES, dtype=float)
    context_features = SYNTHETIC_GENETIC_FEATURES + SYNTHETIC_TREATMENT_FEATURES
    model_rows = pd.concat([rows[["patient_id", "treatment_success_binary", "response_score_percent"]], rows[BASE_NUMERIC_FEATURES + context_features], encoded], axis=1)
    feature_names = BASE_NUMERIC_FEATURES + context_features + list(encoded.columns)

    patient_targets = rows.groupby("patient_id").agg(
        treatment_success_binary=("treatment_success_binary", "first"),
        response_score_percent=("response_score_percent", "last"),
    )
    patients = patient_targets.index.to_numpy()
    y_class = patient_targets["treatment_success_binary"].astype(int).to_numpy()
    train_patients, test_patients = train_test_split(
        patients,
        test_size=config.test_size,
        random_state=config.seed,
        stratify=y_class,
    )
    train_set = set(train_patients)
    train_rows = model_rows[model_rows["patient_id"].isin(train_set)].copy()
    scaler = StandardScaler()
    scaler.fit(train_rows[feature_names].fillna(0.0).astype(float))
    model_rows[feature_names] = scaler.transform(model_rows[feature_names].fillna(0.0).astype(float))

    X_train, yc_train, yr_train, train_ids = _patient_tensor(model_rows, feature_names, train_patients)
    X_test, yc_test, yr_test, test_ids = _patient_tensor(model_rows, feature_names, test_patients)
    return {
        "feature_names": feature_names,
        "X_train": X_train,
        "X_test": X_test,
        "y_class_train": yc_train,
        "y_class_test": yc_test,
        "y_reg_train": yr_train,
        "y_reg_test": yr_test,
        "train_patient_ids": train_ids,
        "test_patient_ids": test_ids,
        "patient_split_disjoint": not bool(set(train_ids) & set(test_ids)),
    }


def _patient_tensor(model_rows: pd.DataFrame, feature_names: list[str], patient_ids: np.ndarray):
    sequences: list[np.ndarray] = []
    y_class: list[float] = []
    y_reg: list[float] = []
    kept_ids: list[str] = []
    max_len = int(model_rows.groupby("patient_id").size().max())
    for patient_id in patient_ids:
        group = model_rows[model_rows["patient_id"] == patient_id].sort_values("cycle")
        if group.empty:
            continue
        seq = group[feature_names].astype(float).to_numpy(dtype=np.float32)
        if len(seq) < max_len:
            pad = np.zeros((max_len - len(seq), seq.shape[1]), dtype=np.float32)
            seq = np.vstack([seq, pad])
        sequences.append(seq[:max_len])
        y_class.append(float(group["treatment_success_binary"].iloc[0]))
        y_reg.append(float(group["response_score_percent"].iloc[-1]) / 100.0)
        kept_ids.append(str(patient_id))
    return (
        np.stack(sequences).astype(np.float32),
        np.asarray(y_class, dtype=np.float32),
        np.asarray(y_reg, dtype=np.float32),
        kept_ids,
    )


def _train_and_evaluate(
    *,
    model_name: str,
    model_factory,
    X_train: np.ndarray,
    X_test: np.ndarray,
    y_class_train: np.ndarray,
    y_class_test: np.ndarray,
    y_reg_train: np.ndarray,
    y_reg_test: np.ndarray,
    config: TrainingConfig,
    state_path: Path,
) -> tuple[dict[str, Any], Path]:
    model = model_factory()
    optimizer = torch.optim.AdamW(model.parameters(), lr=config.learning_rate, weight_decay=1e-4)
    bce = nn.BCEWithLogitsLoss()
    mse = nn.MSELoss()
    dataset = TensorDataset(
        torch.from_numpy(X_train),
        torch.from_numpy(y_class_train).unsqueeze(1),
        torch.from_numpy(y_reg_train).unsqueeze(1),
    )
    loader = DataLoader(dataset, batch_size=config.batch_size, shuffle=True)
    model.train()
    for _ in range(config.epochs):
        for xb, ycb, yrb in loader:
            optimizer.zero_grad()
            class_logits, reg = model(xb)
            loss = bce(class_logits, ycb) + mse(reg, yrb)
            loss.backward()
            optimizer.step()

    metrics = _evaluate_model(model, X_test, y_class_test, y_reg_test)
    state_path.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"model_name": model_name, "state_dict": model.state_dict(), "input_dim": X_train.shape[-1]}, state_path)
    return metrics, state_path


def _evaluate_model(model: nn.Module, X: np.ndarray, y_class: np.ndarray, y_reg: np.ndarray) -> dict[str, Any]:
    model.eval()
    with torch.no_grad():
        class_logits, reg = model(torch.from_numpy(X))
        probs = torch.sigmoid(class_logits).squeeze(1).cpu().numpy()
        reg_pred = torch.clamp(reg.squeeze(1), 0.0, 1.0).cpu().numpy()
    y_pred = (probs >= 0.5).astype(int)
    y_reg_pct = y_reg * 100.0
    reg_pred_pct = reg_pred * 100.0
    return {
        "classification": {
            "auroc": _safe_auc(y_class, probs),
            "pr_auc": _safe_average_precision(y_class, probs),
            "brier": float(brier_score_loss(y_class, probs)),
            "accuracy": float(accuracy_score(y_class, y_pred)),
        },
        "regression": {
            "mae_percent": float(mean_absolute_error(y_reg_pct, reg_pred_pct)),
            "rmse_percent": float(np.sqrt(mean_squared_error(y_reg_pct, reg_pred_pct))),
            "r2": float(r2_score(y_reg_pct, reg_pred_pct)),
        },
    }


def _group_permutation_importance(
    *,
    best: dict[str, Any],
    prepared: dict[str, Any],
    config: TrainingConfig,
    model_path: Path,
) -> list[dict[str, Any]]:
    selected_features = _features_for_variant(prepared["feature_names"], best["variant"])
    selected_idx = [prepared["feature_names"].index(feature) for feature in selected_features]
    X = prepared["X_test"][:, :, selected_idx].copy()
    y_class = prepared["y_class_test"]
    y_reg = prepared["y_reg_test"]
    model = _model_factories(input_dim=X.shape[-1], hidden_size=config.hidden_size, seq_len=X.shape[1])[best["model"]]()
    state = torch.load(model_path, map_location="cpu")
    model.load_state_dict(state["state_dict"])
    base = _evaluate_model(model, X, y_class, y_reg)
    rng = np.random.default_rng(config.seed + 99)
    groups = _feature_groups(selected_features)
    rows: list[dict[str, Any]] = []
    for group_name, group_features in groups.items():
        idx = [selected_features.index(feature) for feature in group_features if feature in selected_features]
        if not idx:
            continue
        X_perm = X.copy()
        perm = rng.permutation(X_perm.shape[0])
        X_perm[:, :, idx] = X_perm[perm][:, :, idx]
        perturbed = _evaluate_model(model, X_perm, y_class, y_reg)
        rows.append({
            "group": group_name,
            "classification_auroc_drop": _round_or_none(
                (base["classification"]["auroc"] or 0.0) - (perturbed["classification"]["auroc"] or 0.0)
            ),
            "regression_mae_increase": _round_or_none(
                perturbed["regression"]["mae_percent"] - base["regression"]["mae_percent"]
            ),
            "recommended_role": _recommended_role(group_name),
        })
    return sorted(
        rows,
        key=lambda row: (
            row["classification_auroc_drop"] or 0.0,
            row["regression_mae_increase"] or 0.0,
        ),
        reverse=True,
    )


def _safe_auc(y_true: np.ndarray, y_score: np.ndarray) -> float | None:
    if len(set(y_true.astype(int).tolist())) < 2:
        return None
    return float(roc_auc_score(y_true, y_score))


def _safe_average_precision(y_true: np.ndarray, y_score: np.ndarray) -> float | None:
    if len(set(y_true.astype(int).tolist())) < 2:
        return None
    return float(average_precision_score(y_true, y_score))


def _seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.set_num_threads(1)


