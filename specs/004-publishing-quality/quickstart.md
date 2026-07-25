# Quickstart: Publishing Quality Closure

## Prerequisites

- Node.js 24 and pnpm 11.9
- Installed frozen dependencies
- Existing repository test environment
- Optional private registered MinerU fixtures for final evidence

## 1. Validate schemas and migrations

```sh
pnpm exec vitest run --project contract tests/contract/book-schema.test.ts
pnpm exec vitest run --project integration tests/integration/publication/config-revisions.test.ts
```

Expected:

- strict v1 and v2 fixtures pass;
- malformed/unknown v2 fields fail;
- v1 migrates to v2 with an empty `source_regions` array and `preserve-v1` provenance;
- invalid, overlapping and digest-mismatched ranges fail.

## 2. Validate printed contents analysis

```sh
pnpm exec vitest run --project unit tests/unit/compiler/printed-toc.test.ts tests/unit/compiler/source-regions.test.ts
pnpm exec vitest run --project integration tests/integration/compiler/configured-document.test.ts
```

Expected:

- a repeated numbered printed contents region becomes a high-confidence proposal;
- ordinary “目录” chapters, ambiguous duplicates and malformed candidates are not
  suppressed;
- accepted regions are absent from active headings, pages, numbering and search input while
  source bytes and reversible structure IDs remain.

## 3. Validate preview/publication parity

```sh
pnpm exec vitest run --project integration tests/integration/compiler/preview-publication-parity.test.ts tests/integration/compiler/version-builder.test.ts
pnpm exec vitest run --project integration tests/integration/publication/stale-preview.test.ts
```

Expected:

- equal captured inputs produce equal pages, headings, numbering, diagnostic codes and
  semantic digest;
- changed source/config/compiler identity makes the earlier preview unpublishable;
- every failure leaves the previous current version readable.

## 4. Validate Chinese typography preprocessing

```sh
pnpm exec vitest run --project unit tests/unit/compiler/typography.test.ts
pnpm exec vitest run --project integration tests/integration/compiler/preview-publication-parity.test.ts
```

Expected:

- Han/Latin and Han/digit boundaries contain exactly one ASCII space;
- specified punctuation is full-width only in eligible Chinese prose;
- code, math, URLs, email, paths, file names, versions, times, decimals, DOI and ISBN
  tokens remain unchanged;
- only intended source slices change, all non-target bytes and the original uploaded file
  are unchanged, the second pass is identical, and persisted Markdown, preview,
  publication and search use the same normalized text.

## 5. Validate formula assets in a browser

```sh
pnpm exec playwright test tests/e2e/publishing-quality.spec.ts
```

Expected:

- renderer stylesheet and WOFF2 requests return 200 with immutable public caching;
- each inline/display formula has one visible representation;
- MathML remains exposed for accessibility;
- no formula asset request fails in preview or reader.

## 6. Run complete automated verification

```sh
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

All commands must pass.

## 7. Run representative performance and real-fixture evidence

```sh
pnpm fixtures:verify-real --dir "$PWD/tests/fixtures/mineru/real"
pnpm build
pnpm benchmark:reference \
  --real-dir "$PWD/tests/fixtures/mineru/real" \
  --retain-dir "$PWD/.cache/publishing-quality-reference" \
  --output-json "$PWD/docs/audits/publishing-quality-results.json" \
  --output-markdown "$PWD/docs/audits/publishing-quality-release.md" \
  --requests 200 \
  --concurrency 8
```

Expected:

- all registered MinerU 3.4.4 samples build and republish without printed-contents or
  duplicate-formula regressions;
- tracked output uses only approved opaque fixture identifiers;
- uncached reader p95 remains at or below 300 ms while the background workload runs.

## Manual acceptance

Open the representative formula- and printed-contents-heavy book:

1. Confirm the preview identifies the printed contents range and shows matched/conflicting
   counts.
2. Confirm the first real chapter is top-level and nested body headings have continuous
   levels.
3. Confirm printed contents entries appear nowhere in published body, navigation, outline,
   numbering or search.
4. Confirm typography summary matches the visible mixed-script prose and protected tokens.
5. Confirm formulas display once in preview and reader.
6. Publish and verify a new immutable version becomes current while the old directory is
   unchanged.
