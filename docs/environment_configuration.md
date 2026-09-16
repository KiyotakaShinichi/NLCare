# Environment configuration

`.env.example` is the canonical human-readable runtime configuration inventory.
Every application variable referenced through `os.getenv` or `os.environ` in
`backend/` and `scripts/` must appear there. CI enforces this with
`python scripts/check_env_documentation.py`.

## Deployment rules

- Copy `.env.example` only as a local starting point. Never commit `.env`.
- `GROQ_API_KEY`, `PINECONE_API_KEY`, `AZURE_SEARCH_API_KEY`, bearer tokens,
  database credentials, and webhook signing secrets must come from a secret
  manager in deployed environments.
- Keep `NLCARE_SYNTHETIC_ONLY=true`. This repository has no approval for real
  patient data or patient care.
- Keep experimental agentic, fine-tuning, managed-vector, and automation
  execution switches disabled unless a bounded synthetic evaluation explicitly
  requires them.
- The `ONCOTRACK_*` variables are compatibility aliases only. New deployments
  should use `NLCARE_*` names.
- DEP-001 artifact paths are protocol-owned. Ordinary development must not use
  them to inspect, rewrite, or rerun consumed one-shot banks.

## Environments

`APP_ENV`/`ENVIRONMENT` should be one of `development`, `test`, `staging`, or
`production`. Staging and production must disable demo authentication, use a
durable database, provide Redis when shared rate limiting is enabled, and pass
`/ready` before receiving traffic. Passing `/ready` demonstrates bounded
engineering dependency availability only; it does not establish clinical
validation, healthcare compliance, or real-patient readiness.

## Operating modes

Three modes, and the variables that select them. Every variable here already
exists; this section is where they are described together, with the model
artifacts each mode needs.

### 1. Offline development and test

No external account, key, or credential. This is what a fresh clone runs.

| Variable | Offline value | Effect |
| --- | --- | --- |
| `ENVIRONMENT` | `development` | Demo sign-in is available. Anywhere else it needs `ALLOW_DEMO_AUTH=true`, and `deployment_boundary_check` flags that combination under `production`. |
| `RAG_FORCE_SPARSE` | `true` | Sparse TF-IDF/BM25 retrieval only. No embedding model is loaded. |
| `RAG_ENABLE_CROSS_ENCODER` | `false` (default) | No reranking model. Enabling it downloads one on first use. |
| `LLM_ADJUDICATION_ENABLED` | `false` | No provider-backed adjudication call. Defaults to `true` in `.env.example`. |
| `HF_HUB_OFFLINE`, `TRANSFORMERS_OFFLINE` | `1` | The model libraries never contact the Hugging Face hub. |
| `NLCARE_TEST_OFFLINE` | `true` | Set by pytest for the default suite: strips provider credentials and blocks every non-loopback socket and DNS lookup. |

Provider keys are simply left unset. The default suite clears them even when
they are set, and `tests/conftest.py` pins the first four values above so a
local run exercises the same retrieval code as CI.

#### Model artifacts

Two sentence-transformer models can be loaded at runtime. They are not
equivalent, and only one is provisioned:

| Model | Used by | How it loads | Provisioned by bootstrap | Without it |
| --- | --- | --- | --- | --- |
| `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` | the DEP-001 semantic-safety runtimes | `local_files_only=True` - never fetched at request time | **yes**, by `scripts/provision_semantic_safety_encoders.py` | the safety layer fails closed (every prompt treated as high-risk) and the classification suites fail |
| `sentence-transformers/all-MiniLM-L6-v2` | dense hybrid retrieval, active whenever `RAG_FORCE_SPARSE` is unset and `sentence-transformers` and `faiss` are installed | plain load - **fetched from the hub on first index build or query** | **no** | `/ready` reports the retrieval runtime `degraded`; retrieval falls back |

The second is a real network dependency of the default configuration, not of
the test suite: `scripts/bootstrap.py` runs `provision_derived_artifacts.py`,
which runs `scripts/ingest_knowledge_base.py`, which calls
`build_rag_vector_index`. With `RAG_FORCE_SPARSE` unset that builds the dense
index and loads `all-MiniLM-L6-v2`. Verified by running that build against an
empty model cache: it fails trying to reach `huggingface.co`.

Set `RAG_FORCE_SPARSE=true` before bootstrap for a setup whose only download is
the semantic-safety encoder.

#### The exact offline commands

```bash
python -m pip install uv==0.8.24
uv sync --frozen                                        # needs the package index
uv run --frozen python scripts/provision_semantic_safety_encoders.py   # one-time model download

export RAG_FORCE_SPARSE=true HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 LLM_ADJUDICATION_ENABLED=false
uv run --frozen python scripts/provision_derived_artifacts.py
uv run --frozen pytest tests -q
```

Everything after the first two lines runs without the network.

To run the part that needs no model at all - what a buyer gets from the
lockfile alone - point every cache at an empty directory and run the suites the
`offline-smoke` CI job runs:

```bash
export HF_HOME="$(mktemp -d)" HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 RAG_FORCE_SPARSE=true
uv run --frozen pytest \
  tests/test_hermetic_network_contract.py \
  tests/test_safety_runtime_empty_cache.py \
  tests/test_health_endpoint.py \
  tests/test_operational_endpoints.py \
  tests/test_auth_demo_environment_gate.py \
  tests/test_access_control.py \
  tests/test_api_input_validation_boundaries.py \
  tests/test_structured_logging.py \
  tests/test_runtime_observability.py \
  tests/test_constants_sync.py \
  tests/test_safety_eval_center.py -q
```

`offline-smoke` runs exactly these with all outbound traffic dropped at the
kernel, which also covers the subprocesses the Python socket guard cannot see.

### 2. Optional external-provider mode

The backend contains adapters for Groq, Ollama, Pinecone, Azure AI Search, n8n,
cBioPortal, and MLflow. Each is gated behind configuration and off unless a key
or endpoint is supplied. They are development integrations for bounded
synthetic evaluation; nothing in the offline path requires them, and their
credentials come from a secret manager rather than a committed file.

### 3. Production deployment requirements

`ENVIRONMENT=production`, demo authentication off, a durable database, Redis
when shared rate limiting is enabled, secrets from a secret manager, and
`/ready` passing before traffic.

Model availability is a deployment decision, not an automatic one. The
container's `serving` profile (`PYTHON_PROFILE=serving`, what docker-compose
builds) installs project dependencies only, which excludes
`sentence-transformers`. In that image the semantic-safety runtimes cannot
import their encoder and fail closed - the deterministic guardrails still run,
but the semantic layer contributes nothing. The `full` profile includes it and
needs the encoder present in the image or a mounted cache.

None of this is clinical validation, healthcare compliance, or approval for
real patient data. `NLCARE_SYNTHETIC_ONLY=true` stays set.

## Runtime probes

Two endpoints, answering two different questions. Conflating them is the
mistake this split exists to avoid.

### `GET /health` — liveness

Returns **200 whenever the process is alive**, and a typed JSON body:

```json
{
  "status": "ok",
  "service": "nlcare_monitoring_prototype",
  "version": "0.0.0",
  "database": { "connected": true, "error_type": null },
  "rag_index": { "loaded": false, "error_type": null }
}
```

| field | meaning |
| --- | --- |
| `status` | `ok` whenever the process can serve requests. Never tracks a dependency. |
| `service` | Stable service identifier. |
| `version` | Running build, or `unknown` if it could not be resolved. Tells an operator *which* build answered. |
| `database.connected` | Whether a bounded `SELECT 1` succeeded at probe time. |
| `database.error_type` | Exception class name when the probe failed, else `null`. Never the message. |
| `rag_index.loaded` | Whether a retrieval index is loaded **in this process**. |
| `rag_index.error_type` | Exception class name if the state could not be read, else `null`. |

Both dependency fields are **informational**. They change the field and nothing
else — not `status`, not the HTTP code:

- **A dead database still returns 200 with `status: ok`.** An orchestrator uses
  liveness to decide whether to *restart* the process, and restarting cannot
  repair a database. A probe that failed on a dependency outage would convert
  that outage into a cluster-wide restart loop.
- **The database probe is bounded** (500 ms, on a worker thread). A liveness
  probe that *hangs* is a restart vector too: an orchestrator that times out
  waiting restarts the process just as surely as a 500 would.
- **`rag_index.loaded: false` is normal, not a fault.** It means this process
  has not served a retrieval query yet; a freshly started replica reports
  `false` until its first search or its prewarm completes. Answering the probe
  never loads or builds an index — it reads in-process cache counters — because
  an orchestrator polling every few seconds must not be able to trigger the
  most expensive work the service does.
- **Nothing sensitive is returned.** Connection failures routinely carry the
  DSN, and this route is unauthenticated, so only the exception *class* is
  reported.

`GET /healthz` is an unlisted alias serving the same handler.

### `GET /ready` — readiness

The authoritative, fail-closed signal. It aggregates database, retrieval index,
and (when shared rate limiting is enabled) Redis, and returns **503** when any
required dependency is unavailable, so a load balancer drains the instance
instead of restarting it.

`/health` tells you whether an index is loaded. `/ready` tells you whether
retrieval is good enough to serve traffic. Those are different questions, which
is why `rag_index` on `/health` carries no `meets_deployment_requirement` field.

Passing `/ready` demonstrates bounded engineering dependency availability only.
It is not clinical validation, healthcare compliance, or real-patient
readiness — the response says so in its own `claim_boundary` field.
