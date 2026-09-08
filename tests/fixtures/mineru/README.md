# MinerU test fixtures

Synthetic MinerU v2 inputs are constructed with `tests/helpers/mineru-v2.ts` and
`tests/helpers/prepare-ir-book.ts`. The import tests exercise nested single-book discovery,
unsupported or missing content and multiple-book rejection directly against those ZIPs.
The retired Markdown/old-JSON candidate registry and its fixtures are removed.

The small files under `synthetic/` exercise printed-contents algorithms through transient
editor syntax. They are not MinerU imports, real-book observations or accepted body files.

## Real acceptance fixtures

Content-correctness acceptance uses fifteen administrator-approved MinerU 3.4.4 books. The
separate performance suite uses the established representative real books and one generated
500-page synthetic stress book. Real ZIPs and reference files are non-redistributable local
inputs and remain outside Git tracking and public CI artifacts. Use the entirely ignored
directory:

```text
tests/fixtures/mineru/real/
├── real-fixtures.json
├── *.zip
├── reference-packs-v2/<fixture-id>/
├── references-v3/<fixture-id>.json
└── observed-v3/<fixture-id>.json
```

An external directory such as `/srv/mirawind-test-fixtures/real-mineru/` remains supported
on a server. Copy `real-fixtures.example.json` to the selected directory as
`real-fixtures.json`, replace the size, hash and page-range placeholders with measured
values, and keep opaque filenames.
The manifest records an opaque ID, filename, frozen MinerU version, page range, byte size,
SHA-256 and approved usage scope. Reference v3 binds independent PDF contents transcription
to original MinerU v2 JSON page/record indices. Old references and review packs may remain
archived locally but are not inputs to current acceptance.

Verify before any content or performance run:

```bash
pnpm fixtures:verify-real --dir "$PWD/tests/fixtures/mineru/real"
```

Generate a review pack before authoring a reference:

```bash
pnpm fixtures:reference-pack \
  --real-dir "$PWD/tests/fixtures/mineru/real" \
  --fixture real-mineru-example \
  --output "$PWD/tests/fixtures/mineru/real/reference-packs-v2/real-mineru-example"
```

Codex opens every rendered candidate contents page with the image-recognition tool and writes
the v3 ground truth directly from the PDF image. Native/OCR/MinerU text only helps locate and
map evidence. Production proposals run after the reference is saved and never fill expected
fields. Body fidelity is checked directly against source JSON text, code and formulas, not
against old Markdown observations. Compare all fifteen after observed outcomes have been built:

```bash
pnpm fixtures:observe-references \
  --real-dir "$PWD/tests/fixtures/mineru/real" \
  --output "$PWD/tests/fixtures/mineru/real/observed-v3"
pnpm fixtures:compare-references \
  --reference-dir "$PWD/tests/fixtures/mineru/real/references-v3" \
  --observed-dir "$PWD/tests/fixtures/mineru/real/observed-v3"
```

During focused algorithm work, select the same 3-5 opaque fixture IDs in both commands. Repeated
`--fixture` options keep ZIP hash verification, observation and strict reference comparison scoped
to those books instead of reading the complete fifteen-book set:

```bash
pnpm fixtures:observe-references \
  --real-dir "$PWD/tests/fixtures/mineru/real" \
  --output "$PWD/.cache/focused-observed-v3" \
  --fixture real-mineru-a1b2c3 \
  --fixture real-mineru-d4e5f6 \
  --fixture real-mineru-123abc
pnpm fixtures:compare-references \
  --reference-dir "$PWD/tests/fixtures/mineru/real/references-v3" \
  --observed-dir "$PWD/.cache/focused-observed-v3" \
  --fixture real-mineru-a1b2c3 \
  --fixture real-mineru-d4e5f6 \
  --fixture real-mineru-123abc
```

Omitting `--fixture` remains the complete release gate and requires all fifteen references.

The verifier rejects other MinerU versions, symlinks, unsafe paths, unexpected fields,
duplicate IDs, wrong usage scope, sizes or hashes. A missing manifest or reference is an
explicit missing-fixture condition, not a passing test.
