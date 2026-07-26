# MinerU test fixtures

Everything committed below `cases/` is a small, synthetic fixture created for Mirawind
tests. It contains no extracted book text and does not claim to be byte-for-byte output from
any particular MinerU release.

`fixtures.json` registers five candidate-selection shapes:

- `cloud`: nested `full.md` with Cloud-style adjacent evidence;
- `cli`: nested `<stem>.md` with CLI-style adjacent evidence;
- `generic`: one Markdown document without MinerU evidence, requiring confirmation;
- `ambiguous`: two plausible Markdown candidates, which must be rejected;
- `multi-book`: two independent CLI-style bundles, which must be rejected.

The fixtures deliberately vary wrapper depth. Candidate selection must recurse and use the
Markdown directory as its resource base; it must never rely on ZIP root position or archive
enumeration order.

## Real acceptance fixtures

Content-correctness acceptance uses fifteen administrator-approved MinerU 3.4.4 books. The
separate performance suite uses the established representative real books and one generated
500-page synthetic stress book. Real ZIPs and reference v2 files are non-redistributable local
inputs and remain outside Git tracking and public CI artifacts. Use the entirely ignored
directory:

```text
tests/fixtures/mineru/real/
├── real-fixtures.json
├── *.zip
├── reference-packs/<fixture-id>/
└── references-v2/<fixture-id>.json
```

An external directory such as `/srv/mirawind-test-fixtures/real-mineru/` remains supported
on a server. Copy `real-fixtures.example.json` to the selected directory as
`real-fixtures.json`, replace the size, hash and page-range placeholders with measured
values, and keep opaque filenames.
The manifest records an opaque ID, filename, frozen MinerU version, page range, byte size,
SHA-256 and approved usage scope. Reference v2 is one strict hash-bound file per fixture.

Verify before any compatibility or performance run:

```bash
pnpm fixtures:verify-real --dir "$PWD/tests/fixtures/mineru/real"
```

Generate a review pack before authoring a reference:

```bash
pnpm fixtures:reference-pack \
  --real-dir "$PWD/tests/fixtures/mineru/real" \
  --fixture real-mineru-example \
  --output "$PWD/tests/fixtures/mineru/real/reference-packs/real-mineru-example"
```

Codex opens every rendered candidate contents page with the image-recognition tool and writes
the v2 ground truth directly from the PDF image. Native/OCR/MinerU text only helps locate and
map evidence. Production proposals run after the reference is saved and never fill expected
fields. Compare all fifteen with `pnpm fixtures:compare-references` after observed outcomes
have been built.

The verifier rejects other MinerU versions, symlinks, unsafe paths, unexpected fields,
duplicate IDs, wrong usage scope, sizes or hashes. A missing manifest or reference is an
explicit missing-fixture condition, not a passing test.
