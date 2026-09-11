"""Feature schema and synthetic context for the deep-learning candidates.

What the candidate models are shown: the base numeric and categorical inputs,
the two synthetic context families (genetic and treatment), and the functions
that derive those contexts and group features for permutation importance.

Split out of ``deep_learning_candidate_benchmark`` so the input contract can be
read and reviewed without the training loop around it. The genetic context is
drawn from its own seeded ``numpy`` generator, so moving it here does not
change a single sampled value.
"""
from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd


BASE_NUMERIC_FEATURES = [
    "cycle",
    "age",
    "pre_wbc",
    "pre_anc",
    "pre_hemoglobin",
    "pre_platelets",
    "nadir_wbc",
    "nadir_anc",
    "nadir_hemoglobin",
    "nadir_platelets",
    "recovery_wbc",
    "recovery_hemoglobin",
    "recovery_platelets",
    "mri_tumor_size_cm",
    "mri_percent_change_from_baseline",
    "max_symptom_severity",
    "symptom_count",
    "intervention_count",
    "dose_delayed",
    "dose_reduced",
]


CATEGORICAL_FEATURES = ["stage", "molecular_subtype", "regimen"]


SYNTHETIC_GENETIC_FEATURES = [
    "genetic_record_available",
    "known_familial_mutation",
    "vus_present",
    "brca1_pathogenic_context",
    "brca2_pathogenic_context",
    "palb2_pathogenic_context",
    "tp53_pathogenic_context",
    "pten_pathogenic_context",
    "chek2_atm_pathogenic_context",
    "pik3ca_somatic_context",
    "tp53_somatic_context",
]


SYNTHETIC_TREATMENT_FEATURES = [
    "chemo_context",
    "anthracycline_taxane_context",
    "platinum_taxane_context",
    "docetaxel_carboplatin_context",
    "anti_her2_targeted_context",
    "endocrine_context",
    "radiation_planned_context",
    "surgery_planned_context",
    "immunotherapy_context",
    "parp_context",
    "supportive_growth_factor_context",
    "multi_modality_count",
]


def _add_synthetic_genetic_context(rows: pd.DataFrame, *, seed: int) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    patient_rows: list[dict[str, Any]] = []
    for patient_id, group in rows.groupby("patient_id", sort=True):
        first = group.iloc[0]
        subtype = str(first.get("molecular_subtype", ""))
        stage = str(first.get("stage", ""))
        age = float(first.get("age", np.nan))
        triple_negative = subtype == "triple-negative"
        her2_pos = "HER2+" in subtype
        advanced = stage in {"IIIA", "IIIB", "IIIC", "IV"}
        young = not math.isnan(age) and age < 50

        record_available = rng.random() < (0.72 if young or triple_negative or advanced else 0.48)
        brca1 = record_available and rng.random() < (0.12 if triple_negative else 0.035)
        brca2 = record_available and rng.random() < (0.055 if not triple_negative else 0.035)
        palb2 = record_available and rng.random() < 0.025
        tp53_germline = record_available and rng.random() < (0.018 if young else 0.006)
        pten = record_available and rng.random() < 0.006
        chek2_atm = record_available and rng.random() < (0.04 if not triple_negative else 0.02)
        known_familial = any([brca1, brca2, palb2, tp53_germline, pten, chek2_atm]) and rng.random() < 0.62
        vus = record_available and rng.random() < 0.16
        pik3ca_somatic = rng.random() < (0.28 if "HR+" in subtype else 0.08)
        tp53_somatic = rng.random() < (0.44 if triple_negative or her2_pos else 0.18)
        patient_rows.append({
            "patient_id": patient_id,
            "genetic_record_available": int(record_available),
            "known_familial_mutation": int(known_familial),
            "vus_present": int(vus),
            "brca1_pathogenic_context": int(brca1),
            "brca2_pathogenic_context": int(brca2),
            "palb2_pathogenic_context": int(palb2),
            "tp53_pathogenic_context": int(tp53_germline),
            "pten_pathogenic_context": int(pten),
            "chek2_atm_pathogenic_context": int(chek2_atm),
            "pik3ca_somatic_context": int(pik3ca_somatic),
            "tp53_somatic_context": int(tp53_somatic),
        })
    return rows.merge(pd.DataFrame(patient_rows), on="patient_id", how="left")


def _add_synthetic_treatment_context(rows: pd.DataFrame) -> pd.DataFrame:
    enriched = rows.copy()
    lower_regimen = enriched["regimen"].fillna("").astype(str).str.lower()
    subtype = enriched["molecular_subtype"].fillna("").astype(str)
    stage = enriched["stage"].fillna("").astype(str)
    cycle = pd.to_numeric(enriched["cycle"], errors="coerce").fillna(0)

    enriched["chemo_context"] = 1
    enriched["anthracycline_taxane_context"] = lower_regimen.str.contains("ac|taxane|paclitaxel|dose-dense").astype(int)
    enriched["platinum_taxane_context"] = lower_regimen.str.contains("carboplatin|platinum").astype(int)
    enriched["docetaxel_carboplatin_context"] = lower_regimen.str.contains("tchp|docetaxel").astype(int)
    enriched["anti_her2_targeted_context"] = (
        subtype.str.contains("HER2\\+", regex=True) | lower_regimen.str.contains("tchp|trastuzumab|pertuzumab")
    ).astype(int)
    enriched["endocrine_context"] = (subtype.str.contains("HR\\+", regex=True) & (cycle >= 5)).astype(int)
    enriched["radiation_planned_context"] = (stage.isin(["IIA", "IIB", "IIIA", "IIIB", "IIIC", "IV"]) & (cycle >= 5)).astype(int)
    enriched["surgery_planned_context"] = (cycle >= 6).astype(int)
    enriched["immunotherapy_context"] = (
        subtype.eq("triple-negative") & lower_regimen.str.contains("carboplatin|paclitaxel")
    ).astype(int)
    enriched["parp_context"] = (
        subtype.eq("triple-negative") & stage.isin(["IIIA", "IIIB", "IIIC", "IV"]) & (cycle >= 5)
    ).astype(int)
    enriched["supportive_growth_factor_context"] = (
        (pd.to_numeric(enriched.get("nadir_anc"), errors="coerce") < 1.2)
        | (pd.to_numeric(enriched.get("dose_delayed"), errors="coerce").fillna(0) > 0)
    ).astype(int)
    modality_cols = [
        "chemo_context",
        "anti_her2_targeted_context",
        "endocrine_context",
        "radiation_planned_context",
        "surgery_planned_context",
        "immunotherapy_context",
        "parp_context",
    ]
    enriched["multi_modality_count"] = enriched[modality_cols].sum(axis=1)
    return enriched


def _feature_groups(feature_names: list[str]) -> dict[str, list[str]]:
    return {
        "imaging_response": [f for f in feature_names if f.startswith("mri_")],
        "cbc_labs": [f for f in feature_names if any(token in f for token in ("wbc", "anc", "hemoglobin", "platelets"))],
        "symptoms_interventions": [
            f for f in feature_names if f in {"max_symptom_severity", "symptom_count", "intervention_count", "dose_delayed", "dose_reduced"}
        ],
        "treatment_context": [f for f in feature_names if f.startswith("regimen_") or f == "cycle"],
        "demographics_stage": [f for f in feature_names if f == "age" or f.startswith("stage_")],
        "biomarker_subtype": [f for f in feature_names if f.startswith("molecular_subtype_")],
        "synthetic_genetic_context": [f for f in feature_names if f in SYNTHETIC_GENETIC_FEATURES],
        "synthetic_treatment_context": [f for f in feature_names if f in SYNTHETIC_TREATMENT_FEATURES],
    }


def _features_for_variant(feature_names: list[str], variant: str) -> list[str]:
    base = [f for f in feature_names if f not in SYNTHETIC_GENETIC_FEATURES and f not in SYNTHETIC_TREATMENT_FEATURES]
    if variant == "without_genetic_context":
        return base
    if variant == "with_genetic_context":
        return base + SYNTHETIC_GENETIC_FEATURES
    if variant == "with_treatment_context":
        return base + SYNTHETIC_TREATMENT_FEATURES
    return feature_names
