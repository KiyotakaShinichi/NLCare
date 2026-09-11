"""The frozen DEP-001B safety banks reproduce exactly from their generator.

The four banks under `Data/evals/safety/dep001b/` are frozen, consumed evidence:
the internal blind was scored against them and they must never be rewritten.
Nothing, until now, showed that they are what `build_corpora` actually produces
from the tracked configuration - the generator had no direct test at all.

`build_corpora` is deterministic (every random draw is seeded from the config),
so this runs it with every output path redirected into a temporary tree and
compares what it writes to the committed banks byte for byte. Line endings are
normalised first, because a Windows checkout converts them and the comparison
is about content, not checkout convention.

It never writes under `Data/evals`: `ROOT`, `OUTPUT_DIR`, and every bank and
manifest path are module globals read at call time, and all of them are
repointed before the call. The committed banks are hashed before and after to
prove it rather than assume it.

Two properties follow:

* **provenance** - the committed banks are exactly the output of the declared
  generator and configuration, so a buyer can regenerate and compare them;
* **refactor safety** - restructuring the generator preserves the corpus if
  and only if this test still passes, which makes that claim checkable instead
  of a matter of reading a diff carefully.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

import backend.services.dep001b_safety_corpus as corpus

BANKS = ("TRAIN_PATH", "VALIDATION_PATH", "INTERNAL_TEST_PATH", "INTERNAL_BLIND_PATH")


def _lf(data: bytes) -> bytes:
    return data.replace(b"\r\n", b"\n")


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture(scope="module")
def regeneration(tmp_path_factory):
    committed = {name: Path(getattr(corpus, name)) for name in BANKS}
    before = {name: _digest(path) for name, path in committed.items()}

    root = tmp_path_factory.mktemp("dep001b_regeneration")
    out = root / "Data" / "evals" / "safety" / "dep001b"
    patch = pytest.MonkeyPatch()
    patch.setattr(corpus, "ROOT", root)
    patch.setattr(corpus, "OUTPUT_DIR", out)
    for name in BANKS:
        patch.setattr(corpus, name, out / committed[name].name)
    patch.setattr(corpus, "MANIFEST_PATH", out / "dataset_manifest.json")
    try:
        manifest = corpus.build_corpora()
        generated = {name: Path(getattr(corpus, name)).read_bytes() for name in BANKS}
    finally:
        patch.undo()

    after = {name: _digest(path) for name, path in committed.items()}
    return {
        "committed": committed,
        "generated": generated,
        "manifest": manifest,
        "before": before,
        "after": after,
        "out": out,
    }


@pytest.mark.parametrize("bank", BANKS)
def test_each_frozen_bank_is_reproduced_byte_for_byte(regeneration, bank: str) -> None:
    committed = _lf(regeneration["committed"][bank].read_bytes())
    generated = _lf(regeneration["generated"][bank])
    assert len(generated) == len(committed), (
        f"{bank}: regenerated {len(generated)} bytes, committed {len(committed)}"
    )
    assert generated == committed, (
        f"{bank} no longer reproduces from build_corpora; the generator or its "
        "configuration has diverged from the frozen evidence"
    )


def test_regeneration_never_touches_the_committed_evidence(regeneration) -> None:
    assert regeneration["before"] == regeneration["after"]


def test_every_output_was_written_inside_the_temporary_tree(regeneration) -> None:
    """Guards the guard: a missed global would have written to the real path."""
    out = regeneration["out"]
    for bank in BANKS:
        assert (out / regeneration["committed"][bank].name).is_file()
    assert (out / "dataset_manifest.json").is_file()


def test_the_regenerated_corpus_keeps_its_claim_boundary(regeneration) -> None:
    manifest = regeneration["manifest"]
    assert manifest["clinical_validation"] is False
    assert manifest["healthcare_production_ready"] is False
    assert manifest["provenance"]["burned_external_holdout_opened_for_authoring"] is False
    assert manifest["provenance"]["internal_blind_loaded_by_training"] is False
