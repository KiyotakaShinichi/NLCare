from __future__ import annotations

import json
import shutil
import sys

import pytest

from scripts.run_dependency_security_scan import (
    _apply_frontend_risk_acceptance,
    _audit_counts,
    _audit_findings,
    _export_canonical_resolution,
    _frontend_controls,
    _python_audit_command,
)


def test_counts_npm_severity_and_packages() -> None:
    payload = {
        "vulnerabilities": {"react-router": {}, "react-router-dom": {}},
        "metadata": {
            "vulnerabilities": {
                "info": 0,
                "low": 0,
                "moderate": 0,
                "high": 2,
                "critical": 1,
                "total": 3,
            }
        },
    }

    assert _audit_counts(json.dumps(payload)) == {
        "high_or_critical_count": 3,
        "known_vulnerability_count": 3,
        "vulnerable_package_count": 2,
    }


def test_counts_pip_audit_findings_without_inventing_severity() -> None:
    payload = {
        "dependencies": [
            {"name": "safe", "vulns": []},
            {"name": "one", "vulns": [{"id": "A"}, {"id": "B"}]},
            {"name": "two", "vulns": [{"id": "C"}]},
        ]
    }

    assert _audit_counts(json.dumps(payload)) == {
        "high_or_critical_count": 0,
        "known_vulnerability_count": 3,
        "vulnerable_package_count": 2,
    }


def test_invalid_output_is_zeroed_instead_of_crashing() -> None:
    assert _audit_counts("not-json") == {
        "high_or_critical_count": 0,
        "known_vulnerability_count": 0,
        "vulnerable_package_count": 0,
    }


def test_extracts_npm_advisory_ids_for_review() -> None:
    payload = {
        "vulnerabilities": {
            "react-router": {
                "via": [
                    {
                        "url": "https://github.com/advisories/GHSA-2j2x-hqr9-3h42",
                        "title": "redirect",
                        "severity": "moderate",
                        "range": "<6.30.4",
                    }
                ]
            }
        }
    }
    assert _audit_findings(json.dumps(payload))[0]["advisory_id"] == "GHSA-2j2x-hqr9-3h42"


def test_frontend_risk_acceptance_requires_current_controls_and_known_ids() -> None:
    accepted = _apply_frontend_risk_acceptance(
        {
            "status": "needs_attention",
            "known_vulnerability_count": 1,
            "high_or_critical_count": 0,
            "findings": [{"advisory_id": "GHSA-2j2x-hqr9-3h42"}],
        }
    )
    assert accepted["status"] == "accepted_residual_risk"
    assert accepted["unaccepted_known_vulnerability_count"] == 0
    assert accepted["risk_acceptance"]["accepted"] is True
    assert _frontend_controls()["passed"] is True


def test_unknown_frontend_advisory_cannot_be_accepted() -> None:
    rejected = _apply_frontend_risk_acceptance(
        {
            "status": "needs_attention",
            "known_vulnerability_count": 1,
            "high_or_critical_count": 0,
            "findings": [{"advisory_id": "GHSA-unknown"}],
        }
    )
    assert rejected["status"] == "needs_attention"
    assert rejected["risk_acceptance"]["accepted"] is False


# ─── which dependency set the Python audit actually measures ──────────────────
#
# The scan used to fork on the platform: Windows audited the checked-in
# `requirements-lock-py314-win.txt`, everything else audited whatever happened
# to be installed. Nothing kept the snapshot current, so the two scopes answered
# different questions and Windows answered a five-week-old one - five advisories
# for versions the project had already moved past, and no coverage at all of the
# twenty-three packages the snapshot had never heard of. These pin the scope to
# the canonical resolution on every platform.


def test_the_audit_scope_is_the_canonical_resolution(tmp_path) -> None:
    resolved = tmp_path / "canonical-resolution.txt"
    resolved.write_text("pypdf==6.16.1\n", encoding="utf-8")

    command = _python_audit_command(resolved)

    assert command is not None
    _, argv, scope = command
    assert scope == "canonical_resolution"
    assert str(resolved) in argv


def test_the_audit_never_reads_a_checked_in_environment_snapshot(tmp_path) -> None:
    """A committed snapshot describes when it was refreshed, not what is locked."""
    resolved = tmp_path / "canonical-resolution.txt"
    resolved.write_text("pypdf==6.16.1\n", encoding="utf-8")

    for argument in _python_audit_command(resolved)[1]:
        assert "requirements-lock-py314-win.txt" not in str(argument)


def test_the_audit_scope_does_not_depend_on_the_platform(monkeypatch, tmp_path) -> None:
    resolved = tmp_path / "canonical-resolution.txt"
    resolved.write_text("pypdf==6.16.1\n", encoding="utf-8")

    monkeypatch.setattr(sys, "platform", "win32")
    _, windows_argv, windows_scope = _python_audit_command(resolved)
    monkeypatch.setattr(sys, "platform", "linux")
    _, linux_argv, linux_scope = _python_audit_command(resolved)

    # Only the audited dependency set is compared. Which pip-audit entry point
    # gets discovered is legitimately platform-dependent - shutil.which consults
    # PATHEXT on Windows and finds pip-audit.EXE where Linux finds nothing and
    # falls back to `python -m pip_audit`. That is the same tool either way; the
    # defect was auditing a different dependency *set* per platform.
    assert windows_scope == linux_scope, "the audit scope still forks on the platform"
    assert _audited_requirements(windows_argv) == _audited_requirements(linux_argv), (
        "the audited dependency set still forks on the platform"
    )


def _audited_requirements(argv: list[str]) -> str | None:
    return argv[argv.index("-r") + 1] if "-r" in argv else None


def test_without_uv_the_live_environment_is_audited_not_a_stale_file(monkeypatch) -> None:
    """Falling back to a file on disk is what produced the phantom findings."""
    command = _python_audit_command(None)

    assert command is not None
    _, argv, scope = command
    assert scope == "installed_environment"
    assert "-r" not in argv


def test_export_reports_failure_instead_of_guessing(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(shutil, "which", lambda _name: None)
    assert _export_canonical_resolution(tmp_path) is None


def test_export_resolves_the_committed_lockfile(tmp_path) -> None:
    """The resolution must be the lockfile's, offline, with exact pins."""
    if shutil.which("uv") is None:
        pytest.fail("uv is required to resolve the dependency contract")

    resolved = _export_canonical_resolution(tmp_path)

    assert resolved is not None and resolved.exists()
    pins = [
        line.split(";")[0].strip()
        for line in resolved.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.startswith("#") and not line.startswith(" ")
    ]
    assert pins, "the export produced no requirements"
    assert all("==" in pin for pin in pins), "the export is not exactly pinned"
    assert any(pin.startswith("pypdf==") for pin in pins)
