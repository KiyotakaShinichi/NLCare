"""The Windows environment snapshot must agree with the canonical lockfile.

`pyproject.toml` and `uv.lock` are the canonical dependency contract.
`requirements-lock-py314-win.txt` is a snapshot of the known-good CPython 3.14
Windows engineering environment, and `backend/services/dependency_lock_audit.py`
generates it from the distributions installed in that environment.

Nothing regenerated it. It was last committed on 2026-08-13 and the repository
has no Windows CI, so it drifted silently for five weeks while `uv.lock` moved
on, and the drift was not cosmetic: the Windows branch of
`scripts/run_dependency_security_scan.py` used the snapshot as its vulnerability
inventory, so the scan reported

  * three pypdf advisories against 6.15.0, which the September remediation had
    already replaced with 6.16.1,
  * one pip advisory fixed in the locked pip, and
  * one transformers advisory fixed seven minor versions before the locked one,

none of which belonged to any dependency set the project actually resolves,
while twenty-two packages present in the contract - `python-json-logger`,
`ruff`, `mypy`, `pip-audit`, `coverage` among them - were absent from the
snapshot entirely and therefore could not have been reported at all. A stale
inventory invents findings and hides them in the same breath.

The snapshot had also been edited by hand: its header no longer matched the
generator's, and `PyJWT` sat between `cryptography` and `cycler` in neither the
canonical spelling nor sorted position, which is not something the generator can
produce.

These tests pin the snapshot to the lockfile so the drift cannot recur silently.
They evaluate environment markers against the target the snapshot itself
declares rather than the machine running pytest, so they hold on Linux CI.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import pytest
from packaging.markers import Marker

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / "requirements-lock-py314-win.txt"

# The generator's own first line. The committed file said "; refreshed after
# advisory review." instead, which is how the hand-editing was visible.
GENERATOR_HEADER = "# Generated environment-specific transitive lock. Do not edit manually."


def _canonical_name(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def _snapshot_header() -> dict[str, str]:
    header: dict[str, str] = {}
    for line in SNAPSHOT.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^#\s*([a-z_]+):\s*(.+)$", line.strip())
        if match:
            header[match.group(1)] = match.group(2).strip()
    return header


def _snapshot_pins() -> dict[str, str]:
    pins: dict[str, str] = {}
    for line in SNAPSHOT.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        name, separator, version = line.partition("==")
        assert separator, f"snapshot line is not an exact pin: {line!r}"
        pins[_canonical_name(name)] = version
    return pins


def _marker_environment() -> dict[str, str]:
    """The environment the snapshot declares, not the one running pytest."""
    header = _snapshot_header()
    full_version = header["python_version"]
    major_minor = ".".join(full_version.split(".")[:2])
    implementation = header["python_implementation"]
    return {
        "python_full_version": full_version,
        "python_version": major_minor,
        "implementation_name": implementation.lower(),
        "platform_python_implementation": implementation,
        "platform_system": header["platform_system"],
        "platform_machine": header["platform_machine"],
        "sys_platform": "win32",
        "os_name": "nt",
    }


def _canonical_resolution() -> dict[str, str]:
    """`uv.lock` resolved for the snapshot's declared environment.

    `uv export --frozen` reads the committed lockfile and never resolves over
    the network. `scripts/verify_fresh_clone.sh` refuses to run without uv and
    invokes the suite through `uv run`, so requiring it here cannot quietly
    retire this check.
    """
    uv = shutil.which("uv")
    if uv is None:
        pytest.fail(
            "uv is required to verify the dependency contract; install uv==0.8.24. "
            "Skipping instead would leave the snapshot unchecked."
        )
    exported = subprocess.run(
        [uv, "export", "--frozen", "--no-hashes", "--no-emit-project"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    environment = _marker_environment()
    resolved: dict[str, str] = {}
    for line in exported.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        requirement, _, marker = line.partition(";")
        requirement = requirement.strip()
        if "==" not in requirement:
            continue
        if marker.strip() and not Marker(marker.strip()).evaluate(environment):
            continue
        name, _, version = requirement.partition("==")
        resolved[_canonical_name(name)] = version.strip()
    return resolved


def test_the_snapshot_pins_nothing_the_contract_does_not_resolve() -> None:
    """Phantom packages are what produced the five bogus advisories."""
    phantom = sorted(set(_snapshot_pins()) - set(_canonical_resolution()))
    assert not phantom, (
        f"{SNAPSHOT.name} pins packages absent from uv.lock: {phantom}. "
        "Vulnerabilities reported against these belong to no dependency set the "
        "project resolves. Regenerate the snapshot from a `uv sync --frozen` "
        "environment."
    )


def test_the_snapshot_omits_nothing_the_contract_resolves() -> None:
    """The quieter half of the defect: an omitted package cannot be reported."""
    missing = sorted(set(_canonical_resolution()) - set(_snapshot_pins()))
    assert not missing, (
        f"{SNAPSHOT.name} is missing packages the contract resolves: {missing}. "
        "An advisory against any of them would go unreported."
    )


def test_every_snapshot_version_matches_the_locked_version() -> None:
    resolution = _canonical_resolution()
    snapshot = _snapshot_pins()
    drift = [
        {"package": name, "snapshot": snapshot[name], "uv_lock": resolution[name]}
        for name in sorted(set(snapshot) & set(resolution))
        if snapshot[name] != resolution[name]
    ]
    assert not drift, f"{SNAPSHOT.name} has drifted from uv.lock: {drift}"


def test_the_snapshot_declares_the_windows_python_314_target() -> None:
    """Regenerating on Linux and committing that would silently retarget it."""
    header = _snapshot_header()
    assert header["platform_system"] == "Windows"
    assert header["python_implementation"] == "CPython"
    assert header["python_version"].startswith("3.14."), header["python_version"]
    assert header["platform_python_tag"] == "cp314"


def test_the_snapshot_is_machine_generated_rather_than_hand_edited() -> None:
    """`PyJWT` out of order and out of case is what a manual edit looked like."""
    lines = SNAPSHOT.read_text(encoding="utf-8").splitlines()
    assert lines[0] == GENERATOR_HEADER, (
        "the snapshot header does not match the generator's; it was edited by hand. "
        "Refresh it with dependency_lock_audit.write_environment_transitive_lock()."
    )
    pins = [line.split("==")[0] for line in lines if line.strip() and not line.startswith("#")]
    assert pins == [_canonical_name(name) for name in pins], (
        "package names are not in canonical form, so the file was not generated"
    )
    assert pins == sorted(pins), "package names are not sorted, so the file was not generated"
    assert len(pins) == len(set(pins)), "the snapshot pins a package twice"


def test_regeneration_is_deterministic(tmp_path: Path) -> None:
    """Two refreshes of one environment must agree, or the file is not a lock."""
    from backend.services.dependency_lock_audit import write_environment_transitive_lock

    first = tmp_path / "first.txt"
    second = tmp_path / "second.txt"
    write_environment_transitive_lock(first)
    write_environment_transitive_lock(second)
    assert first.read_bytes() == second.read_bytes()
