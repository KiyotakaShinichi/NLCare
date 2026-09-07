"""`backend.models` stays the single import surface after the module split.

The ORM classes were moved out of `backend/models.py` along two boundaries the
module already described in prose: MLOps lineage (which model version produced
a prediction) and the SaaS control plane (organizations, entitlements, usage) -
neither of which describes a patient.

Two things have to survive a move like that, and neither is obvious from
reading the diff:

* **Table registration.** SQLAlchemy registers a table when its class is
  imported. A model in a module nobody imports simply does not exist at
  `create_all` time, and the failure surfaces later as a missing table rather
  than an import error.
* **The import surface.** 112 modules import from `backend.models`. The split
  is a source-layout change; it must not be an API change.

The re-export check is derived from the submodules rather than hardcoded, so
adding a class to one of them and forgetting the re-export fails here instead
of silently dropping a table.
"""

from __future__ import annotations

import inspect

import backend.models as models
import backend.models_ml as models_ml
import backend.models_saas as models_saas
from backend.database import Base


def _declared_in(module) -> set[str]:
    """ORM classes defined in this module - not ones it merely imported."""
    return {
        name
        for name, obj in vars(module).items()
        if inspect.isclass(obj)
        and issubclass(obj, Base)
        and obj is not Base
        and obj.__module__ == module.__name__
    }


def test_every_split_out_class_is_re_exported_by_the_facade() -> None:
    for module in (models_ml, models_saas):
        declared = _declared_in(module)
        assert declared, f"{module.__name__} declares no ORM classes; the split lost content"
        missing = sorted(name for name in declared if not hasattr(models, name))
        assert not missing, f"{module.__name__} classes not re-exported by backend.models: {missing}"


def test_importing_the_facade_registers_every_table() -> None:
    """Importing `backend.models` alone must be enough for `create_all`."""
    registered = set(Base.metadata.tables)
    for table in ("model_registry", "saas_organizations", "saas_audit_events", "patients"):
        assert table in registered, f"{table} is not registered on Base.metadata"


def test_the_submodules_share_the_declarative_base() -> None:
    """Two Bases would produce two metadata registries and half a schema."""
    for module in (models_ml, models_saas):
        for name in _declared_in(module):
            assert getattr(module, name).metadata is Base.metadata


def test_the_split_modules_hold_no_patient_tables() -> None:
    """The boundary claim is that neither module describes a person.

    Asserted on the table names the modules actually declare, so moving a
    patient-scoped table into either one fails here.
    """
    for module, prefix in ((models_ml, ("model_", "ml_", "prediction_")), (models_saas, ("saas_",))):
        for name in _declared_in(module):
            table = getattr(module, name).__tablename__
            assert table.startswith(prefix), (
                f"{table} does not belong to {module.__name__}'s bounded context"
            )
