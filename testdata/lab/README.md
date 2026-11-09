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
