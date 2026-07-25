# M1 User Story 1 import and private-preview evidence

Date: 2026-07-24

## Result

User Story 1 passes with the repository's minimized synthetic MinerU fixtures. The sole
administrator can stream one ZIP, observe durable worker state, confirm a generic candidate,
inspect a revision-pinned private preview, and receive a complete rejection for an ambiguous
package. No import becomes public.

This story checkpoint originally preceded the real-fixture handoff. Final acceptance under
D-097 subsequently verified the administrator-approved MinerU 3.4.4 set: 583-page and
441-page representative real books, a 97-page real compatibility book and a 500-page
synthetic stress book. The final compatibility and latency evidence is recorded in
`docs/audits/m1-performance-report.md`; the checkpoint results below remain the evidence
captured when User Story 1 first completed.

## Automated evidence

- `pnpm format` — passed.
- `pnpm typecheck` — passed with 137 Astro/TypeScript files and no diagnostics.
- `pnpm lint` — passed.
- `pnpm test` — 32 test files and 166 tests passed.
- `pnpm build` — production Astro server, worker processes and runtime schema copy passed.
- `pnpm test:e2e` — one Chromium production-stack journey passed in 8.2 seconds.

## Covered behavior

- Multipart upload is parsed as a stream; the service performs actual-byte counting,
  SHA-256 hashing, exclusive `.part` creation, fsync, durable rename and idempotent enqueue.
- Empty optional `target_book_id` values emitted by an HTML form are treated as omitted;
  unknown fields, invalid IDs and extra parts are rejected and cleaned.
- High-confidence MinerU Cloud structure proceeds automatically.
- A generic single Markdown pauses at `needs_main_confirmation` and only then exposes a
  confirmation action.
- Ambiguous candidates reach `rejected`, show safe evidence and never expose confirmation
  actions.
- Web and worker run as separate production processes against the SQLite durable queue.
- Draft metadata, candidate evidence, diagnostics, task status, preview HTML and preview
  assets are administrator-only and use non-storing/non-indexing response policies.
- Anonymous requests using real and nonexistent import, job, book, preview-page and asset
  identifiers produce matching hidden `404` representations.
- Task serialization exposes safe state, phase, attempt, scalar progress and error category,
  while excluding lease ownership and internal error detail.
- Preview HTML and assets use book/config-revision-pinned authenticated URLs.
- The browser journey verifies that the accepted Markdown snapshot is byte-identical to the
  input and has no write bits.

## Defects found by the production journey

The production-stack test found and locked regressions for:

1. worker runtime JSON schemas missing from `dist/docs/schemas`;
2. blank optional HTML multipart fields being rejected;
3. rejected ambiguous candidates incorrectly retaining confirmation buttons;
4. Playwright runtime data being placed under its automatically deleted report directory.
