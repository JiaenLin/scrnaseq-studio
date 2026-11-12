# What the Lab's converter writes: the studio's cross-repository fixtures

These are bundles that [scRNA-seq Lab](https://github.com/JiaenLin/scrnaseq-lab)'s own converter wrote. That
converter is `bin/scrnaseq-lab.mjs convert`, the command line that runs the Lab app's modules. The bundles are
**committed**, unlike the rest of `testdata/`, because everything in them is synthetic. They come from the Lab's
committed fixtures (samples `s1`..`s8`, types `TypeA`..`TypeD`, neutral factors), some of them edited with made-up
levels and records. No real object goes in this folder.

`scripts/test-lab-bundles.mjs` opens them through the studio's own reader, so the contract between the two
repositories is tested on the writer's real bytes rather than on an imitation of them. The test first checks the
sha256 values below.

## Where they came from

- **Lab commit:** `d5b0244349ca1fcb04ce14cb084dbb5218877ff5`, branch `autodev/W017-lab-integrity`.
- **Command:** `node scripts/make-lab-bundles.mjs <scrnaseq-lab checkout>`.
- **What the script does:**
  - It builds the edited inputs from the Lab's fixtures, with the Lab's own h5wasm.
  - It runs the Lab's converter on each input with the flags shown below, from a temporary directory.
- **Reproducible:** the converter gives the same bytes for the same input and flags, so a rerun against the same
  Lab commit writes these files again exactly.
- **Regenerating** against a different Lab commit is a deliberate change: update the table and the commit above.

| file | sha256 | input and flags |
|---|---|---|
| `family-2x2.zip` | `8555b7fafaa8e28e7aa1ecf72ae0f6e81a4d1d549ae15a0e45846bf3b44ebf44` | `scripts/fixtures/family-2x2.h5ad` |
| `no-record.zip` | `099f4227273f92cc24931b876e95c14033c088554f46eb48f09cfc100dc17917` | `scripts/fixtures/nullable-mask.h5ad` |
| `odd-levels.zip` | `2bf36eb1601dc0dc0f266905322b596d009c8781dee5961531d2d44045e07759` | `oddlevels.h5ad --condition odd --label x` |
| `collide.zip` | `28007cc4f3ac62f95e5982bd76b47d5e489cb47320c0d3873f42f70b9428da4e` | `collide.h5ad --sample donor --condition crossed --extra factor_a --extra factor_b --label x` |
| `budget.zip` | `710445c459a38d6a7886dc5c0d4bce0ec9944392e85cfdc6e2f507872ebe4094` | `budget.h5ad` |

## What each one is for

- **`family-2x2`** is the Lab's committed fixture as it is. Its `run` holds one record, `uns/scintegrate/provenance`.
- **`no-record`** is the Lab's committed fixture with nothing about the run in `uns`. Its `run.records` is empty.
  It has no sample column, so the Lab names its two samples `all cells|g1` and `all cells|g2`.
- **`odd-levels`** splits three samples by a condition level that is empty, starts with `|`, or holds `||`. That
  gives the ids `s1|`, `s2||x` and `s3|a||b`. A pseudobulk header split on `||` misreads all three samples (GAP-C52).
  It is the W017 verifier's probe: the same rule and the same flags give the same bytes.
- **`collide`** splits `s1` into names other samples already have (`s1|c1`, `s1|c2`, `s1|c2#2`). That gives
  `#2` and `#3` ids.
- **`budget`** holds records the converter cannot copy whole:
  - `uns/a_provenance` is over the 262,144 bytes one record may take, so it is named with its size.
  - `uns/f_provenance` is past the run section's 1,048,576 bytes, so it is left out.
  - `uns/harness_run` is a JSON string, which the converter parses.

## The run section, state by state: `run-states.json`

`scripts/test-run-states.mjs` reads what the studio says about run records for every state of a run section, each
state as the Lab writes it today and as it wrote it before. `run-states.json` holds the `run` section and the
`notes` of one bundle per state and per Lab commit, taken from the converter's own bundles by
`node scripts/make-run-states.mjs <dir> <new commit> <old commit>`. A bundle that is byte for byte a committed
fixture is named, not copied (`budget.zip` is what the old commit writes for its object).

- **new:** Lab `fdb88884de3685bf47a4df8542d707a90fc9301a`, recorded in the file as `lab.new`: a record is
  listed by up to six named fields.
- **old:** Lab `ca0cc73c08371498828dcb71ba6c08b422b652e0`, recorded as `lab.old`: a record is copied.
- **Command, per object and commit:** `bin/scrnaseq-lab.mjs convert <object>.h5ad <out>.zip --label p`.

The objects are synthetic: the Lab's committed fixtures with made-up `uns` entries, written with h5py in AnnData's
encodings. A "good" record holds a `tool` and a `version`; a "six-less" one holds a `level` and a `method`.

| object | what its `uns` holds |
|---|---|
| `N00_norecord` | nothing about the run (the Lab's `nullable-mask.h5ad`) |
| `U2_0L_uninspected` | one entry the converter cannot inspect, and no record |
| `R04_0L_sixless_string` | a six-less record and a record that is a string |
| `R05_0L_cap` | 64 six-less records, then two good ones past the cap |
| `R01_family` | the Lab's `family-2x2` fixture: three tools' records, an annotation's record and the harness's string |
| `R08_65good` | 65 good records |
| `R06_mixed` | a six-less record, a good one, one whose `commit` is 257 characters, and one after it |
| `R06b_mixed_after` | a good record, one whose `commit` is 257 characters, a six-less one and a good one after it |
| `R07_empty6` | one record whose six fields are each an empty string |
| `B00_budget` | the `budget` object above |

