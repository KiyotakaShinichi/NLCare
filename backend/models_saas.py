"""SaaS control-plane tables: tenancy, entitlement, metering, and dispatch.

Split out of ``backend.models`` along the boundary the original module already
described in a comment - these rows are about organizations, projects, and
usage, never about a patient. Keeping them in a separate module makes the
tenant-isolation boundary visible in the import graph rather than in a comment.

The tables register on ``Base.metadata`` at import, and ``backend.models``
re-exports every name, so existing imports and table creation are unchanged.
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
    UniqueConstraint,
)
from sqlalchemy.sql import func

from backend.database import Base


# SaaS control-plane tables are intentionally separate from the synthetic
# patient-demo tables above. This keeps tenant isolation explicit and avoids
# implying that legacy clinical-demo rows are ready for multi-tenant use.


class SaaSOrganization(Base):
    __tablename__ = "saas_organizations"

    id = Column(String, primary_key=True)
    slug = Column(String, nullable=False, unique=True, index=True)
    name = Column(String, nullable=False)
    status = Column(String, nullable=False, default="active", index=True)
    plan_code = Column(String, nullable=False, default="engineering_preview")
    data_class = Column(String, nullable=False, default="synthetic_only")
    created_by_subject = Column(String, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class SaaSMembership(Base):
    __tablename__ = "saas_memberships"
    __table_args__ = (
        UniqueConstraint("organization_id", "subject", name="uq_saas_membership_org_subject"),
    )

    id = Column(String, primary_key=True)
    organization_id = Column(
        String,
        ForeignKey("saas_organizations.id"),
        nullable=False,
        index=True,
    )
    subject = Column(String, nullable=False, index=True)
    role = Column(String, nullable=False, index=True)
    status = Column(String, nullable=False, default="active", index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class SaaSProject(Base):
    __tablename__ = "saas_projects"
    __table_args__ = (
        UniqueConstraint("organization_id", "slug", name="uq_saas_project_org_slug"),
    )

    id = Column(String, primary_key=True)
    organization_id = Column(
        String,
        ForeignKey("saas_organizations.id"),
        nullable=False,
        index=True,
    )
    slug = Column(String, nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String, nullable=False, default="active", index=True)
    data_class = Column(String, nullable=False, default="synthetic_only")
    created_by_subject = Column(String, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class SaaSEnvironment(Base):
    __tablename__ = "saas_environments"
    __table_args__ = (
        UniqueConstraint("project_id", "environment_key", name="uq_saas_environment_project_key"),
    )

    id = Column(String, primary_key=True)
    organization_id = Column(
        String,
        ForeignKey("saas_organizations.id"),
        nullable=False,
        index=True,
    )
    project_id = Column(String, ForeignKey("saas_projects.id"), nullable=False, index=True)
    environment_key = Column(String, nullable=False)
    name = Column(String, nullable=False)
    status = Column(String, nullable=False, default="active", index=True)
    retrieval_profile = Column(String, nullable=False, default="sparse_governed")
    data_class = Column(String, nullable=False, default="synthetic_only")
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class SaaSEntitlement(Base):
    __tablename__ = "saas_entitlements"
    __table_args__ = (
        UniqueConstraint("organization_id", "metric_key", name="uq_saas_entitlement_org_metric"),
    )

    id = Column(String, primary_key=True)
    organization_id = Column(
        String,
        ForeignKey("saas_organizations.id"),
        nullable=False,
        index=True,
    )
    metric_key = Column(String, nullable=False, index=True)
    unit = Column(String, nullable=False)
    hard_limit = Column(Float, nullable=False)
    soft_limit = Column(Float, nullable=True)
    period = Column(String, nullable=False, default="monthly")
    enabled = Column(Integer, nullable=False, default=1)
    source = Column(String, nullable=False, default="engineering_preview")
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class SaaSUsageEvent(Base):
    __tablename__ = "saas_usage_events"
    __table_args__ = (
        UniqueConstraint("organization_id", "idempotency_key", name="uq_saas_usage_org_idempotency"),
    )

    id = Column(String, primary_key=True)
    organization_id = Column(
        String,
        ForeignKey("saas_organizations.id"),
        nullable=False,
        index=True,
    )
    project_id = Column(String, ForeignKey("saas_projects.id"), nullable=True, index=True)
    environment_id = Column(String, ForeignKey("saas_environments.id"), nullable=True, index=True)
    metric_key = Column(String, nullable=False, index=True)
    quantity = Column(Float, nullable=False)
    unit = Column(String, nullable=False)
    source = Column(String, nullable=False, index=True)
    billable = Column(Integer, nullable=False, default=0, index=True)
    provider_request_id = Column(String, nullable=True, index=True)
    idempotency_key = Column(String, nullable=False)
    metadata_json = Column(Text, nullable=True)
    occurred_at = Column(DateTime(timezone=True), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class SaaSPlatformJob(Base):
    __tablename__ = "saas_platform_jobs"
    __table_args__ = (
        UniqueConstraint("organization_id", "idempotency_key", name="uq_saas_job_org_idempotency"),
    )

    id = Column(String, primary_key=True)
    organization_id = Column(
        String,
        ForeignKey("saas_organizations.id"),
        nullable=False,
        index=True,
    )
    project_id = Column(String, ForeignKey("saas_projects.id"), nullable=False, index=True)
    environment_id = Column(String, ForeignKey("saas_environments.id"), nullable=True, index=True)
    job_type = Column(String, nullable=False, index=True)
    status = Column(String, nullable=False, default="queued", index=True)
    payload_json = Column(Text, nullable=True)
    result_json = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    progress_percent = Column(Integer, nullable=False, default=0)
    attempts = Column(Integer, nullable=False, default=0)
    max_attempts = Column(Integer, nullable=False, default=3)
    idempotency_key = Column(String, nullable=False)
    created_by_subject = Column(String, nullable=False, index=True)
    queued_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    available_at = Column(DateTime(timezone=True), nullable=True, index=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    cancelled_at = Column(DateTime(timezone=True), nullable=True)
    lease_owner = Column(String, nullable=True, index=True)
    lease_token = Column(String, nullable=True, unique=True, index=True)
    lease_expires_at = Column(DateTime(timezone=True), nullable=True, index=True)
    recovery_count = Column(Integer, nullable=False, default=0)


class SaaSOutboxEvent(Base):
    __tablename__ = "saas_outbox_events"
    __table_args__ = (
        UniqueConstraint("organization_id", "idempotency_key", name="uq_saas_outbox_org_idempotency"),
    )

    id = Column(String, primary_key=True)
    organization_id = Column(
        String,
        ForeignKey("saas_organizations.id"),
        nullable=False,
        index=True,
    )
    project_id = Column(String, ForeignKey("saas_projects.id"), nullable=True, index=True)
    aggregate_type = Column(String, nullable=False, index=True)
    aggregate_id = Column(String, nullable=False, index=True)
    event_type = Column(String, nullable=False, index=True)
    payload_json = Column(Text, nullable=False)
    status = Column(String, nullable=False, default="pending", index=True)
    attempts = Column(Integer, nullable=False, default=0)
    max_attempts = Column(Integer, nullable=False, default=5)
    idempotency_key = Column(String, nullable=False)
    available_at = Column(DateTime(timezone=True), nullable=False, index=True)
    dispatched_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)
    lease_owner = Column(String, nullable=True, index=True)
    lease_token = Column(String, nullable=True, unique=True, index=True)
    lease_expires_at = Column(DateTime(timezone=True), nullable=True, index=True)
    recovery_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class SaaSAuditEvent(Base):
    __tablename__ = "saas_audit_events"

    id = Column(String, primary_key=True)
    organization_id = Column(
        String,
        ForeignKey("saas_organizations.id"),
        nullable=False,
        index=True,
    )
    project_id = Column(String, ForeignKey("saas_projects.id"), nullable=True, index=True)
    actor_subject = Column(String, nullable=False, index=True)
    actor_role = Column(String, nullable=False, index=True)
    action = Column(String, nullable=False, index=True)
    target_type = Column(String, nullable=False)
    target_id = Column(String, nullable=True)
    request_id = Column(String, nullable=True, index=True)
    details_json = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
