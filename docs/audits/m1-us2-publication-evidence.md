# M1 User Story 2 atomic-publication evidence

Date: 2026-07-25

## Result

User Story 2 passes with the repository's minimized synthetic MinerU fixtures. The
administrator can edit every M1 structure override, retain the last completed preview during
a rebuild, publish a complete immutable version in the background, and leave the previous
published version current when a subsequent build fails.

This story checkpoint originally preceded the real-fixture handoff. Final acceptance under
D-097 subsequently verified the administrator-approved MinerU 3.4.4 set: 583-page and
441-page representative real books, a 97-page real compatibility book and a 500-page
synthetic stress book, including publication while the prior version remained readable.
The final evidence is recorded in `docs/audits/m1-performance-report.md`; the checkpoint
results below remain the evidence captured when User Story 2 first completed.

## Automated evidence

- `pnpm exec vitest run --project contract tests/contract/config-publish.contract.test.ts tests/contract/document-manifest.test.ts`
  — 2 files and 9 tests passed.
- `pnpm exec vitest run --project integration tests/integration/compiler tests/integration/publication`
  — 12 files and 46 tests passed.
- `pnpm exec vitest run --project unit tests/unit/worker/protocol.test.ts` — 1 file and 5 tests
  passed.
- `pnpm test:e2e` — both Chromium production-stack journeys passed; the publication journey
  completed in 9.9 seconds and the import/private-preview journey in 7.8 seconds.
- `pnpm format`, `pnpm typecheck`, `pnpm lint`, and `pnpm build` — passed after the story
  implementation and evidence synchronization.

## Covered behavior

- Each accepted configuration is an immutable, versioned `book.yaml` revision guarded by a
  strong ETag and semantic cross-field validation.
- Display titles, H1–H4 levels, TOC inclusion, four inherited content roles and heading-only
  page starts affect derived output without reordering authoritative Markdown.
- Markdown is compiled to semantic HTML with safe math/code fallbacks, repaired internal and
  footnote links, deterministic pages, version-pinned resources and a strict canonical
  `document-manifest.json`.
- Version metadata, copied authoritative inputs, generated files, hashes, link/resource
  closure and search-row identity are validated before a complete marker is written.
- Recursive fsync and same-filesystem rename make the version directory immutable before the
  ready-version/search transaction.
- The final guarded transaction compares captured source, config revision and predecessor
  pointer before atomically changing version states, `current_version_id`, visibility, audit
  and job result.
- Injected failures before and after fsync, rename, ready/search registration and current
  pointer cutover never expose a partial version.
- Stale source/config/current captures and competing publishers cannot cut over.
- Publication policy is an explicit M1 allow extension and does not invent a rights
  confirmation record.
- Draft/private visibility changes are immediate, origin checked and independent of a
  rebuild.
- The browser UI shows background progress and keeps the previous version available through
  validation or build failure.

## Defect found by the production journey

The production-stack test found that the draft endpoint reported the last completed stale
preview as the current revision's `ready` state. The client therefore stopped polling while
the new preview was still building and never enabled publication. The endpoint now separates
the displayable ready-preview pointer from the current revision's build state, and the
browser journey locks the regression.
