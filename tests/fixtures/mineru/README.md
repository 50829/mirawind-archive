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

## Real several-hundred-page fixtures

The administrator will provide two or three real MinerU 3.4.4 ZIPs during final testing.
They are non-redistributable test inputs and must remain outside Git tracking, public CI
artifacts, and logs. For local development, use the entirely ignored directory:

```text
tests/fixtures/mineru/real/
├── real-fixtures.json
├── real-mineru-a7f31c.zip
└── real-mineru-b9d204.zip
```

An external directory such as `/srv/mirawind-test-fixtures/real-mineru/` remains supported
on a server. Copy `real-fixtures.example.json` to the selected directory as
`real-fixtures.json`, replace the size, hash and page-range placeholders with measured
values, and keep opaque filenames.
The manifest records only an opaque ID, filename, the frozen MinerU 3.4.4 version,
approximate page range, byte size, SHA-256 and the administrator-approved usage scope. Do not
record book titles, authors or extracted content.

Verify before any compatibility or performance run:

```bash
pnpm fixtures:verify-real --dir "$PWD/tests/fixtures/mineru/real"
```

The verifier rejects other MinerU versions, symlinks, paths, unexpected fields, duplicate
IDs, wrong usage scope, wrong sizes and wrong hashes. A missing external manifest is an
explicit missing-fixture condition, not a passing real-fixture test. Final M1 acceptance
requires all registered real fixtures; the synthetic fixtures cannot substitute for them.
