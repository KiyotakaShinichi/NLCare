"""Model registry, experiment, and prediction-lineage tables.

Split out of ``backend.models`` because this is MLOps bookkeeping rather than
patient record-keeping: which model version produced a prediction, on which
inputs, and with what reproducibility hash. Nothing here describes a person.

The tables register on ``Base.metadata`` at import, and ``backend.models``
re-exports every name, so ``from backend.models import ModelRegistry`` keeps
working and table creation is unaffected by the move.
"""
from __future__ import annotations

from sqlalchemy import (
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.sql import func

from backend.database import Base


class ModelRegistry(Base):
    __tablename__ = "model_registry"

    id = Column(Integer, primary_key=True, index=True)
    model_name = Column(String, nullable=False, index=True)
    model_version = Column(String, nullable=False, index=True)
    task = Column(String, nullable=False)
    artifact_path = Column(Text, nullable=False)
    metrics_path = Column(Text, nullable=True)
    training_data_path = Column(Text, nullable=True)
    model_metadata_json = Column(Text, nullable=True)
    status = Column(String, nullable=False, default="active")
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class MLExperimentRun(Base):
    __tablename__ = "ml_experiment_runs"

    id = Column(Integer, primary_key=True, index=True)
    run_id = Column(String, nullable=False, unique=True, index=True)
    experiment_name = Column(String, nullable=False, index=True)
    run_name = Column(String, nullable=True)
    status = Column(String, nullable=False, default="running", index=True)
    params_json = Column(Text, nullable=True)
    metrics_json = Column(Text, nullable=True)
    artifacts_json = Column(Text, nullable=True)
    tags_json = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=False)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class PredictionAuditLog(Base):
    __tablename__ = "prediction_audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(String, ForeignKey("patients.id"), index=True)
    model_name = Column(String, nullable=False)
    model_version = Column(String, nullable=False)
    input_reference = Column(Text, nullable=True)
    prediction_json = Column(Text, nullable=False)
    explanation_json = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class PredictionTrace(Base):
    """End-to-end traceability row for one evidence-aware prediction.

    Every call to `predict_with_abstention` that opts into tracing writes
    one row here.  The schema is a flat audit record — indexable fields for
    filtering (status, decision, question, model_version), JSON columns for
    list/dict payloads that don't need indexing.  All medical claims are
    monitor-only; this table records what the system said, not what the
    correct clinical answer is.
    """

    __tablename__ = "prediction_traces"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    patient_id = Column(String, ForeignKey("patients.id"), nullable=True, index=True)
    request_id = Column(String, nullable=True, index=True)
    actor_role = Column(String, nullable=True, index=True)

    # What was asked + how it was answered.
    question = Column(String, nullable=False, index=True)
    decision = Column(String, nullable=False, index=True)
    probability = Column(Float, nullable=True)
    raw_probability = Column(Float, nullable=True)
    calibrated = Column(Integer, nullable=False, default=0)
    confidence = Column(String, nullable=True)

    # Evidence-sufficiency snapshot.
    evidence_sufficiency = Column(String, nullable=True, index=True)
    abstained = Column(Integer, nullable=False, default=0, index=True)
    abstain_reason = Column(String, nullable=True)
    modalities_present_json = Column(Text, nullable=True)
    modalities_missing_json = Column(Text, nullable=True)
    confidence_modifier = Column(Float, nullable=True)

    # Model + configuration provenance — the four "what was running" fields
    # a reviewer needs to reproduce or audit a prediction.
    model_version = Column(String, nullable=False)
    feature_set_version = Column(String, nullable=True)
    threshold_config_json = Column(Text, nullable=True)
    calibration_config_json = Column(Text, nullable=True)

    # Cross-layer linkage: safety rules that fired, the validator's verdict,
    # and any RAG sources the response leaned on (when the trace is for a
    # chat-driven inference, not a batch eval).
    safety_triggers_json = Column(Text, nullable=True)
    validator_decision = Column(String, nullable=True, index=True)
    rag_source_ids_json = Column(Text, nullable=True)

    # Optional snapshot fingerprint of the patient timeline that produced
    # the row.  Lets a clinician reproduce the exact input later.
    timeline_snapshot_hash = Column(String, nullable=True, index=True)

    # Free-form notes the validator or caller wants to attach.
    notes = Column(Text, nullable=True)
