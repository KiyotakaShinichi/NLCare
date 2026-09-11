# DEP-001 Safety Release Architecture

## Layered Contract

1. Normalize current input and bounded prior user turns.
2. Apply deterministic urgent, treatment, diagnosis, privacy, and security
   checks.
3. Run the semantic unsafe-intent classifier as a separate signal.
4. For uncertain cases, compose requested-action and protected-target slots.
   Safety-critical uncertainty routes to refusal/clarification and disables
   cache reuse.
5. Run the security input guardrail before retrieval.
6. Route high-risk turns to deterministic refusal composition. Provider and
   caller fallback prose is discarded on that lane.
7. Apply source-tier and allowed-use policy to any educational retrieval.
   Retrieved text cannot change the safety envelope.
8. Run answer/citation validation, medical-claim boundary checks, the
   post-generation safety validator, semantic output-actionability validation,
   and evidence-envelope authorization.
9. Buffer the response until release authorization. Exceptions at safety,
   retrieval, cache, generation, or validator layers return a fail-closed
   envelope.
10. Re-run semantic output-actionability validation immediately before transport.
    A post-generation/transport disagreement blocks release and strips citations.

The final holdout and evaluation implementation are never imported by these
production modules. This prevents rule logic from reading case text or IDs.

## Operational Boundary

The DEP-001D release boundary is stronger than the route classifier: its frozen
1,600-case blind bank released zero unsafe canaries and passed 10/10 fault
injections, but unsafe recall was 0.8725, safe acceptance was 0.7913, over-refusal
was 0.2088, and multi-turn unsafe recall was 0.8033. The one-shot result is
`BLOCKED_BEHAVIORAL`; candidate and bank are consumed. DEP-001 therefore remains
a hard deployment blocker. This is engineering evidence only, not clinical
validation or production-healthcare readiness.

Post-candidate development adds a narrowly bounded safe-utility consensus for
benign portal operations and direct clinical education. It may preserve a
low-risk route only when independent classifiers agree, unsafe and urgent
probabilities are low, explicit personalized-action grammar is absent, no
current urgent symptom is detected, and the independent urgent head is below
threshold. This is not part of the frozen DEP-001D candidate and has no new
blind-evaluation claim.

## Candidate freeze and post-freeze drift

`Data/evals/safety/dep001b/candidate_freeze_manifest.json` hash-binds the 26
artifacts that made up the DEP-001B candidate when it was frozen on 2026-08-13,
before the internal blind run. The manifest is protected evidence and is not
rewritten, and re-freezing is refused by design once a blind receipt exists.

Ten of the 26 no longer match the code on `main`.

**Recorded incident (1).** `Data/evals/safety/dep001b/latest_overlap_audit.json`
was overwritten by a timed-out test fixture after the blind run. It is
documented in `latest_freeze_integrity_incident.json`, which reports 25 of 26
matching at that point.

**Post-incident changes (9).** These changed afterwards and are not covered by
the incident record:

| Frozen artifact | Commits since the freeze |
| --- | --- |
| `config/release_gate_thresholds.yaml` | 855d2d2 (2026-08-13), f65109d (2026-08-20) |
| `backend/services/safety_policy_action.py` | f65109d (2026-08-20) |
| `backend/services/dep001b_semantic_safety.py` | f65109d (2026-08-20) |
| `backend/services/dep001b_safety_corpus.py` | f65109d (2026-08-20), ac152df (2026-08-21) |
| `backend/services/dep001b_safety_evaluation.py` | f65109d (2026-08-20) |
| `backend/services/agent_safety.py` | 855d2d2, f65109d, ac152df, 0098343 (2026-08-23), 61e1b53 (2026-08-29) |
| `backend/services/agent_intent_router.py` | f65109d (2026-08-20), a06a304 (2026-08-24) |
| `backend/services/agent_rag.py` | 855d2d2, f65109d, a06a304 (2026-08-24) |
| `backend/services/post_generation_validator.py` | 855d2d2, f65109d (2026-08-20) |

**Still matching.** The four safety banks, the model, calibration, thresholds,
and model manifest, the training evaluation and runtime assurance artifacts,
and the blind-run scaffolding (`dep001b_candidate_freeze.py`,
`dep001b_overlap_audit.py`, `dep001b_semantic_safety_training.py`,
`dep001b_runtime_assurance.py`, `dep001b_internal_blind_evaluation.py`).

What this means:

- For those nine files, the code on `main` is not the evaluated candidate. The
  blind metrics preserved in the incident record describe the frozen candidate,
  are already marked non-decisive, and say nothing about current `main`.
- DEP-001 remains blocked. Nothing here changes that or supports any claim about
  the current implementation.
- `verify_frozen_candidate()` reports these mismatches, so
  `dep001b_internal_blind_evaluation` refuses to run against current `main`.
  That is correct: the bank is consumed.
- A future external evaluation must freeze the then-current candidate afresh; it
  cannot reuse this manifest.
- The banks remain reproducible from the current generator even though its
  source changed - `tests/test_dep001b_corpus_reproducibility.py` regenerates
  them and compares byte for byte.

Since this disclosure was written, `dep001b_safety_corpus.py` has also been
split: its vocabulary and case renderers moved verbatim to
`backend/services/dep001b_corpus_language.py` (ADR 0012). That module is not in
the freeze either. What pins the generator to the frozen banks now is the
reproducibility test, not the freeze.

`tests/test_dep001b_freeze_drift_disclosure.py` pins this list. A change to a
frozen artifact that still matches fails that test until it is disclosed here.
Digests are compared across line-ending forms, because the manifest recorded
on-disk bytes and a Windows checkout converts text files.
