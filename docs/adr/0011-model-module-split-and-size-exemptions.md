# 0011 — models.py split, and two files that stay over the limit

**Status**: accepted
**Date**: 2026-09

## Context

Three authored files sat above the 500-LOC service limit and were repeatedly
raised as code-cleanliness debt: `backend/models.py` (854),
`backend/services/dep001b_safety_corpus.py` (795), and
`backend/services/ten_out_of_ten_roadmap.py` (785).

Being over the limit is not by itself a reason to split. `scripts/check_file_size.py`
is a ratchet, not a flat ban: known files may shrink but never grow, and a *new*
file must come in under 500. That second rule matters here, because it means a
split that merely relocates bulk into a new oversized module is rejected by
design — the tool will not let a large file be created and then baselined.

So each file was assessed for whether it contains more than one subject, not
for whether it exceeds a number.

## Decision

**Split `backend/models.py`.** It held 44 ORM classes covering three unrelated
subjects, and the file already said so: a comment above the SaaS block read
"SaaS control-plane tables are intentionally separate from the synthetic
patient-demo tables above". The boundary existed in prose; this moves it into
the import graph.

- `backend/models_ml.py` — `ModelRegistry`, `MLExperimentRun`,
  `PredictionAuditLog`, `PredictionTrace`. MLOps lineage: which model version
  produced a prediction, on what inputs, reproducibly.
- `backend/models_saas.py` — the nine `SaaS*` tables. Tenancy, entitlement,
  metering, dispatch. (See also ADR 0010.)
- `backend/models.py` — the patient clinical domain, 552 LOC.

Neither extracted module describes a person, which is the test applied to
decide what moved. `backend.models` re-exports every moved class, so the 112
importing modules are untouched and importing the facade still registers all
44 tables on `Base.metadata`.

**Do not split `backend/services/dep001b_safety_corpus.py`.** Its output
location is not a parameter: `build_corpora` writes the four safety banks and
the dataset manifest to hardcoded paths under `Data/evals/safety/dep001b`.
Executing it is the only way to prove a refactor preserved the generated corpus
byte for byte, and executing it overwrites frozen DEP-001B evidence. The usual
safety net for a refactor is therefore unavailable: correctness could not be
demonstrated without doing the thing the evidence contract forbids. The
vocabulary tables, case renderers and integrity checks are one deterministic
pipeline whose seed order decides the corpus, so a silent reordering is a real
risk and the gain would be a file-size number.

If it is ever split, that belongs in the same change that regenerates the
corpus under an explicit evidence-refresh decision — not in a cleanup pass.

**Do not split `backend/services/ten_out_of_ten_roadmap.py`.** Roughly 500 of
its lines are one literal table of `DimensionRating` and `RoadmapItem` values.
The executable part is two `to_dict` methods and the ~70 lines that assemble
and write the artifact; there is no logic to separate from data. Lifting the
table into its own module produces a new file over the limit, which the ratchet
rejects. Cutting the table in half is an arbitrary boundary, and moving it to
JSON trades the dataclass's compile-time typing for a parse-time failure mode
with no behavioural gain.

## Consequences

- `models.py` drops 854 → 552 and its ratchet baseline is lowered to match, so
  the reduction cannot silently reverse.
- `saas_foundation_readiness` verified three tables by scanning `models.py` as
  text and is repointed at `models_saas.py`. That source-path coupling was the
  only real regression the move caused, which is why a readiness test ships in
  the same commit.
- Two files remain over the limit with a recorded reason. A future reader who
  finds them should read this ADR before "fixing" them — in one case the fix is
  unverifiable, and in the other it is not an improvement.
- The count of authored files over 500 LOC is not a project goal. Two of the
  three flagged files were assessed and deliberately left alone.
