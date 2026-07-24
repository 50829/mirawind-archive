# M1 User Story 3 public-reader evidence

Date: 2026-07-25

## Result

User Story 3 passes with the repository's minimized synthetic MinerU fixtures. Anonymous
readers consume only pre-generated current-version HTML, navigate a semantic reader, search
long and short queries under different scopes, load version-pinned resources and resume the
registered original ZIP. A public-to-private transition denies every new anonymous
page/resource/search/download request without rebuilding or changing the current pointer.

This story checkpoint originally preceded the administrator's real-fixture handoff. Final
acceptance subsequently verified both registered MinerU 3.4.4 ZIPs, including the 441-page
representative book, plus the synthetic stress book. The compatibility and latency evidence
is recorded in `docs/audits/m1-performance-report.md`; the checkpoint measurements below
remain the evidence captured when User Story 3 first completed.

## Automated evidence

- `pnpm exec vitest run --project contract tests/contract/public-reading.contract.test.ts`
  — 1 file and 4 tests passed.
- `pnpm exec vitest run --project integration tests/integration/auth/public-resource-matrix.test.ts tests/integration/auth/visibility-transition.test.ts tests/integration/http/cache-indexing.test.ts tests/integration/http/original-download.test.ts tests/integration/search/book-search.test.ts tests/integration/compiler/semantic-render.test.ts tests/integration/compiler/version-builder.test.ts`
  — 7 files and 29 tests passed.
- `pnpm exec vitest run --project unit tests/unit/http/downloads.test.ts tests/unit/search/query.test.ts`
  — 2 files and 6 tests passed.
- `pnpm test:e2e` — both Chromium production-stack journeys passed; the combined
  configuration/publication/public-reader journey completed in 9.1 seconds and the
  import/private-preview journey in 7.9 seconds.
- `pnpm format`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` — passed after
  implementation and evidence synchronization.

## Covered behavior

- Numeric and alias book/page keys resolve one current book/version capture; malformed,
  missing and anonymous private resources share a non-cacheable hidden response.
- Reading requests return immutable pre-generated HTML and never parse Markdown, render
  formulas, highlight code or build indexes.
- Public HTML uses route/version/renderer-specific strong ETags with mandatory revalidation;
  private administrator reads use `private, no-store`.
- Numeric entry routes redirect without caching to current canonical aliases, while generated
  HTML carries canonical metadata.
- Version-pinned assets expose only current or previously published versions while the book
  remains public; ready, failed and corrupt versions remain hidden.
- The reader has a fixed top bar, whole-book TOC, semantic body, current-page outline,
  previous/next links, focus-safe keyboard navigation and responsive layout.
- The published DOM contains headings, lists, tables, figure captions, KaTeX, labelled code,
  footnote links and教材 containers without PDF.js, canvas or iframe rendering.
- Search normalizes NFC/newlines, counts Unicode code points, quotes FTS5 syntax as a literal
  phrase and restricts one/two-character queries to title/author/heading rows.
- Every search query filters both visibility and `current_version_id`; private, old and
  orphan rows do not leak.
- Reader search renders snippets with `textContent`, so result text is never interpreted as
  HTML.
- Original downloads use a title-derived UTF-8 name plus `book-<id>.<ext>` fallback,
  `nosniff`, a hash ETag, `private, no-store`, noindex and strict single byte ranges.
- A sparse 2 GiB original verifies closed/open/suffix ranges, `206`, `304`, `416`, If-Range,
  resumed byte identity and authorization before conditional/range handling.
- Immediate private transition is verified in both SQLite integration tests and the
  production browser journey for HTML, assets, search and originals.

## Defects found by the production journey

The production journey found that a paragraph body match was mislabeled as a heading-only
match when its surrounding heading contained the same query. Search now prioritizes the
matched block's body before inherited heading text, and both integration and browser tests
lock the corrected snippet and result kind.
