# 0012 — DEP-001B corpus generator split; ADR 0011's corpus premise withdrawn

**Status**: accepted (supersedes the `dep001b_safety_corpus.py` decision in ADR 0011)
**Date**: 2026-09

## Context

ADR 0011 left `backend/services/dep001b_safety_corpus.py` unsplit on the
grounds that its output location is not a parameter, so proving a refactor
preserved the corpus would mean executing the generator and overwriting frozen
DEP-001B evidence.

That premise was wrong. `build_corpora` reads `ROOT`, `OUTPUT_DIR`, and every
bank and manifest path as module globals at call time, so all of them can be
redirected into a temporary tree. The generator is deterministic, and run that
way it reproduces all four frozen banks byte for byte in a few seconds without
writing anything under `Data/evals`.
`tests/test_dep001b_corpus_reproducibility.py` now does exactly that, and
hashes the committed banks before and after to prove nothing was touched.

Checking the premise also surfaced that the file had already left the DEP-001B
candidate freeze: it changed in `ac152df` (2026-08-21), after the 2026-08-13
freeze. So "a split would break the freeze" is no reason either. The freeze
identifies the evaluated candidate, not current `main`; that drift, and the
nine other drifted artifacts, are disclosed in
`docs/dep001_safety_release_architecture.md`.

## Decision

Split the generator along the line between *how a case is phrased* and *which
cases are built*:

- `backend/services/dep001b_corpus_language.py` — the languages, styles, slot
  vocabulary, utility kinds, and the six case renderers. It is self-contained:
  none of these references anything on the construction side.
- `backend/services/dep001b_safety_corpus.py` — label policy, split sizing and
  seeding, the control-case builders, integrity checks, and file output.

The move is verbatim and in original order. The reproducibility test was
committed before the split and passes after it; that is the evidence the split
preserved behaviour, rather than a careful reading of the diff. It earned its
place immediately: one renderer used `hashlib`, which the new module did not
import, and the test failed on it before anything was committed.

The roadmap decision in ADR 0011 stands and was re-measured: the ratings table
alone spans lines 67–565 of `ten_out_of_ten_roadmap.py`, so any module holding
it plus its imports exceeds 500 lines, and any cut through it is arbitrary.

## Consequences

- Both corpus modules are under the 500-line limit, and
  `dep001b_safety_corpus.py` leaves the ratchet baseline.
- A change to either module that alters any rendered case fails the
  reproducibility test. Changing the corpus is an evidence decision taken
  explicitly, not a side effect of a refactor.
- Neither module matches the historical freeze. The freeze manifest remains the
  identity of the evaluated candidate and is not rewritten.
- ADR 0011 was wrong about how the generator could be validated. The error is
  recorded here rather than edited out of 0011.
