"""Every mutating route has an explicit, auditable validation boundary."""

from __future__ import annotations

from backend.api.main import app
from backend.services.api_boundary_inventory import build_mutating_boundary_inventory


def test_mutating_boundary_inventory_is_complete_and_machine_readable() -> None:
    inventory = build_mutating_boundary_inventory(app.openapi())
    openapi = app.openapi()
    expected = sum(
        method in path_item
        for path_item in openapi["paths"].values()
        for method in ("post", "put", "patch", "delete")
    )

    assert len(inventory) == expected
    assert inventory == sorted(inventory, key=lambda row: (row["path"], row["method"]))
    assert all(
        row["classification"]
        in {
            "typed_request_body",
            "query_or_path_only",
            "multipart_or_file_upload",
            "explicit_raw_body_exception",
        }
        for row in inventory
    )


def test_raw_body_exception_is_unique_and_justified() -> None:
    inventory = build_mutating_boundary_inventory(app.openapi())
    raw = [row for row in inventory if row["classification"] == "explicit_raw_body_exception"]

    assert raw == [
        {
            "path": "/admin/automation/delivery-receipts",
            "method": "POST",
            "classification": "explicit_raw_body_exception",
            "request_schema": None,
            "justification": (
                "The HMAC signature covers the exact request bytes before the validated "
                "receipt object is constructed. Parsing first would invalidate the security contract."
            ),
        }
    ]


def test_typed_request_bodies_publish_a_schema() -> None:
    inventory = build_mutating_boundary_inventory(app.openapi())
    typed = [row for row in inventory if row["classification"] == "typed_request_body"]
    assert typed
    assert all(row["request_schema"] for row in typed)


# --- a body must be a declared model, not merely a body ----------------------


def _component_schemas() -> set[str]:
    return set(app.openapi().get("components", {}).get("schemas", {}))


def test_every_request_body_resolves_to_a_declared_model() -> None:
    """`request_schema` being truthy is not the same as being typed.

    `_schema_name` falls back to the raw JSON Schema `type` when an operation
    publishes no `$ref`, so a handler declared `payload: dict = Body(...)`
    yields `"object"` - classified `typed_request_body`, carrying a non-empty
    `request_schema`, and therefore passing every other assertion in this file
    while validating nothing at the boundary.

    The distinction that matters is whether the name resolves to a component
    schema, because only a declared model produces one. All 58 current bodies
    do; this fails on the first one that does not.
    """
    inventory = build_mutating_boundary_inventory(app.openapi())
    declared = _component_schemas()

    untyped = [
        (row["method"], row["path"], row["request_schema"])
        for row in inventory
        if row["classification"] == "typed_request_body" and row["request_schema"] not in declared
    ]
    assert not untyped, (
        "body-bearing endpoints without a declared request model: "
        + "; ".join(f"{m} {p} (schema={s!r})" for m, p, s in untyped)
    )


def test_an_untyped_body_would_be_detected() -> None:
    """The guard above is only worth having if it can fail.

    A hand-built document standing in for `payload: dict = Body(...)`: a real
    request body whose schema is inline rather than a component reference.
    """
    document = {
        "paths": {
            "/admin/untyped-probe": {
                "post": {
                    "requestBody": {
                        "content": {"application/json": {"schema": {"type": "object"}}}
                    }
                }
            }
        },
        "components": {"schemas": {}},
    }
    inventory = build_mutating_boundary_inventory(document)
    row = inventory[0]

    assert row["classification"] == "typed_request_body"
    assert row["request_schema"] == "object"
    assert row["request_schema"] not in set(document["components"]["schemas"])
