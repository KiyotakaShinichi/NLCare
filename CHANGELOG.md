# Changelog

All notable repository changes will be recorded here. This project has not yet
published a tagged release; historical entries are intentionally not invented.

## Unreleased

### Added

- `tests/test_dep001b_corpus_reproducibility.py`: regenerates the four frozen
  DEP-001B safety banks into a temporary tree and compares them to the
  committed ones byte for byte, so the corpus is provably the output of its
  declared generator and configuration.
- An `offline-smoke` CI job: dependencies install, then iptables and ip6tables
  drop all outbound traffic, every model cache points at an empty directory,
  and the suites that need no model run - including the one asserting the
  safety layer fails closed without its encoder.
- Frontend telemetry for the three paths that bypassed the request transport:
  streamed chat, authenticated artifact previews, and non-API failures in the
  shared tool-form submit hook, which also gained its first tests.
- An "Operating modes" section documenting the offline, optional-provider, and
  production modes, and the two runtime models - only one of which is
  provisioned.

- `backend/api/routers/health.py`: the operational probes are now a router
  registered with `app.include_router(health.router)`, like every other route
  group, instead of being decorated inline on the app object.
- `scripts/verify_fresh_clone.sh` and a `fresh-clone-smoke` CI job: a clean
  checkout with no restored virtualenv or `node_modules` is bootstrapped, the
  backend suite runs hermetically, the frontend is built, and the run prints
  `FRESH CLONE OK`.
- A `ml-regression` CI job running the deterministic perturbation and
  patient-grouped temporal cross-validation suites offline against committed
  synthetic fixtures.
- Field-level Pydantic constraints on the patient write boundaries, and
  `tests/test_api_input_validation_schema.py` covering malformed payloads for
  `/me/symptoms`, `/me/labs`, and `/me/chat`.
- Contract tests for the API client's request core: `ApiError` status
  classification, in-flight GET de-duplication, error normalisation, and
  single-report failure telemetry.
- Responsibility-named modules for the SaaS control plane, governance
  credibility artifacts, admin analytics, and the synthetic perturbation
  retrain evaluation, each behind its original module as a compatibility
  facade.
- A shrink-only backend service size ratchet
  (`scripts/check_file_size.py`) that freezes pre-existing debt and blocks new
  oversized modules.
- A source-plus-tests discipline check
  (`scripts/check_change_discipline.py`) with a structural, AST-based
  documentation-only exemption.
- Full-suite fresh-clone verification with hermetic accounting: every test file
  executed, live credentials stripped, non-loopback egress blocked, and any
  skip attributable to a missing network or credential treated as a failure.
- An empty-model-cache proof that the semantic safety runtimes fail *closed*
  rather than open when their encoder is unavailable.
- `backend/app_logging.py` as the canonical logging entrypoint, with an
  explicit python-json-logger import.
- Retrieval index state on `GET /health`, alongside database connectivity and
  the running version.
- Explicit HTTP 422 request-validation evidence for the patient write
  boundaries.
- Canonical `pyproject.toml` and `uv.lock` dependency workflow.
- Ruff, incremental mypy, frontend lint/typecheck, full offline coverage, and
  dependency-audit CI gates.
- Canonical structured JSON logging and bounded liveness/readiness probes.
- Source-enforced environment configuration documentation.
- Contributor, dependency-security, licensing/provenance, and repository
  hardening documentation.
- Complete offline backend coverage execution with a hard CI floor.
- Focused regression tests for privacy-process education and isolated demo-auth
  fixtures.

### Changed

- `backend/models.py` split into ML-lineage and SaaS control-plane modules;
  `dep001b_safety_corpus.py` split into corpus language and dataset
  construction; the deep-learning benchmark split into features, architectures,
  and reporting. Each move is verified by a reproducibility or pinned-commit
  equivalence test rather than by review alone.
- `tests/conftest.py` pins the retrieval and adjudication mode the default
  suite runs under, so a local run and a CI run exercise the same code instead
  of differing by whatever is in a model cache.


- `backend/services/agent_rag.py` is now a 211-line facade; branch execution
  moved to `agent_pipeline_runner` and response shaping to
  `agent_result_shaping`, with the cache lookup and intent validation returned
  to the modules that own those subjects. No backend file now exceeds 1000
  lines.
- Structural bounds for patient records are declared once in
  `backend.services.input_validation` and imported by the Pydantic schemas, so
  the HTTP boundary and the support agent's record-write path cannot drift into
  different limits. A request that breaches one is now refused at the boundary
  with 422 rather than reaching the handler and being refused with 400;
  accepted inputs are unchanged.
- `backend/logging_config.py` is the canonical logging module and
  `backend/app_logging.py` re-exports it, rather than the reverse.
- `GET /health` now reports `status`, `service`, `version`, database
  reachability, and whether the retrieval index is loaded in this process. All
  dependency fields are informational: the endpoint returns 200 while the
  process is alive, and answering it never loads an index or blocks on a hung
  database. `/ready` remains the authoritative, fail-closed readiness signal.
- Dependency profiles are uv dependency groups rather than separate manifests;
  `uv sync --frozen --no-default-groups` installs the minimal serving runtime.
- Dependabot groups Python updates by stack (ml, reporting, dev tooling,
  runtime) so a model-library bump is reviewed apart from a web-framework bump.
- Pinned direct Python dependencies and updated vulnerable Pillow, Torch, and
  Setuptools versions in the canonical lock inputs.
- Split admin observability routes and MLE statistical diagnostics into
  responsibility-named modules without changing their public contracts.
- Corrected privacy-process routing so consent education remains answerable
  while mixed disclosure demands and prompt-injection instructions fail closed.

### Fixed

- The DEP-001C evaluation lock could fail to acquire under load. Deciding
  whether an existing lock belonged to a live run or a crashed one shelled out
  to PowerShell on Windows, which cost ~1.8s per probe idle and exceeded its
  own 10s timeout under the load of a full test suite, raising
  `TimeoutExpired` out of lock acquisition instead of returning an answer. The
  probe now asks the kernel directly via `OpenProcess` (~0.3ms). On POSIX, a
  PID owned by another user reported `PermissionError`, which was read as
  "dead" and would have let a second run recover a live run's lock as stale;
  liveness now fails closed, and only a positive "no such process" counts as
  dead.

### Security

- Request logging redacts sensitive identifiers and prompt/token/password-like
  fields and avoids request bodies.
- Dependency auditing is release-blocking according to the documented policy.
- Patient demo authentication tests now create only their own synthetic fixture
  instead of depending on persistent local database state.

### Known limitations

- The DEP-001B candidate freeze (2026-08-13) no longer matches `main` for 10 of
  its 26 artifacts: one recorded fixture incident and nine later source and
  configuration changes. For those files `main` is not the evaluated candidate.
  Disclosed in `docs/dep001_safety_release_architecture.md`.
- Dense hybrid retrieval, the default when `RAG_FORCE_SPARSE` is unset, loads
  `sentence-transformers/all-MiniLM-L6-v2` from the Hugging Face hub on first
  use. No provisioning step fetches it, and it is loaded without
  `local_files_only`. Documented, not changed.


- The semantic safety encoder is a ~480 MB multilingual transformer that must
  be provisioned once with network access. It cannot be replaced by a small
  bundled fixture: the tokenizer's 250k-token vocabulary alone accounts for
  ~384 MB of embedding weights, and a randomly-initialised stand-in would
  satisfy the loading contract while invalidating the classifier heads trained
  on the real encoder's embedding space.
- DEP-001 remains blocked by official behavioral evidence.
- No real patient data, clinical validation, clinician sign-off, IRB approval,
  healthcare compliance claim, or production healthcare readiness.
- The source code does not yet have an explicit root license, and some external
  knowledge/data assets have noncommercial, unknown, or dataset-specific terms.
