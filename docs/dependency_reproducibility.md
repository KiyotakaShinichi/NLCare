# Dependency reproducibility

`pyproject.toml` and `uv.lock` are the canonical cross-platform dependency
contract. Direct runtime and development dependencies are exact-pinned in the
project manifest; the lock records the resolved transitive graph for supported
Python versions. CI must install with a pinned uv version and `uv sync --frozen`
so dependency resolution cannot drift during a build.

Update dependencies intentionally:

```powershell
uv lock --upgrade-package <package-name>
uv sync --frozen
python scripts/check_dependency_contract.py
python -m pip check
```

## Install profiles

There is no `requirements.txt` and no `requirements-serving.txt`. Profiles are
uv dependency groups, so there is exactly one place a version is written:

| profile | command | contents |
| --- | --- | --- |
| development / CI | `uv sync --frozen` | project dependencies + `dev`, `ml`, `reporting` |
| minimal serving | `uv sync --frozen --no-default-groups` | project dependencies only |

`[project].dependencies` is the minimal request-path runtime. The heavier
stacks live in groups:

- `ml` — torch, torchvision, sentence-transformers, shap;
- `reporting` — matplotlib, reportlab;
- `dev` — pytest, ruff, mypy, pip-audit, and friends.

`[tool.uv] default-groups` lists all three, so a plain `uv sync --frozen` still
installs exactly what it installed when these packages were flat runtime
dependencies. The groups exist so the *serving image* can opt out, not so the
default environment can shrink. `scripts/check_dependency_contract.py` fails if
a declared group is missing from `default-groups`, because that would quietly
change what every developer and CI job installs without any file appearing to
move.

The container resolves the same lockfile rather than a manifest maintained
beside it. `Dockerfile` takes `ARG PYTHON_PROFILE` (`full` or `serving`) and
runs the matching `uv export`; `docker-compose.synthetic-staging.yml` builds
with `PYTHON_PROFILE: serving`.

## Why the manifests were removed

They were hand-maintained exports of a canonical source, and being exact-pinned
never made them correct: two files can both be perfectly pinned to
*disagreeing* versions, which ships one dependency set to the container and a
different one to every test. That failure was only detectable by a contract
that compared them. The contract is now simply that they do not exist —
`scripts/check_dependency_contract.py` fails if either path reappears, and says
what to do instead. CI runs that check in `static-quality`, and
`tests/test_dependency_contract.py` covers each failure mode.

To add or change a dependency: edit `pyproject.toml`, run `uv lock`, and commit
the lockfile. There is no second file to mirror it into.


## The Windows engineering snapshot

`requirements-lock-py314-win.txt` records the known-good CPython 3.14 Windows
engineering environment together with its interpreter/platform fingerprint. It
is a snapshot of installed distributions, not a second dependency contract:
`uv.lock` is still the only place a version is decided.

Because it records what is *installed*, it is only meaningful if the environment
it is taken from is the locked one. Refresh it from Windows, and sync first:

```powershell
uv sync --frozen --python 3.14
.\.venv\Scripts\python.exe -c "from backend.services.dependency_lock_audit import write_environment_transitive_lock as w; w()"
```

Syncing first is the whole procedure, not a precaution. The snapshot previously
drifted for five weeks because it was refreshed from whatever happened to be
installed on one machine: it pinned a pypdf the September advisory fix had
already replaced, and omitted twenty-three packages the lockfile resolves.
`tests/test_windows_dependency_lock_reconciliation.py` now fails if the snapshot
disagrees with `uv.lock`, if it pins something the lockfile does not resolve, if
it omits something the lockfile does resolve, or if it has been edited by hand.

`scripts/run_dependency_lock_audit.py --refresh-transitive-lock` performs the
same refresh and additionally writes
`Data/evals/ops/latest_dependency_lock_audit.json`, reporting direct-lock drift,
transitive graph drift, missing or extra distributions, the lock SHA-256, and an
environment-fingerprint mismatch. Use it when that evidence artifact is meant to
be regenerated; use the two commands above when only the snapshot is.

Vulnerability scanning does not read this file.
`scripts/run_dependency_security_scan.py` resolves `uv.lock` with
`uv export --frozen` and audits that, identically on every platform, so the scan
measures the declared contract rather than the age of a checked-in snapshot.

The Windows snapshot is intentionally platform-scoped and is not the CI lock.
Run dependency and container audits separately; a reproducible graph is not a
security certification. Deployment still requires reviewed image digests,
SBOMs, transitive/container scans, signing, and isolated verification. None of
these controls establishes compliance or makes NLCare healthcare production
ready.
