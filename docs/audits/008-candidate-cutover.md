# 008 immutable candidate cutover

Date: 2026-07-30

## Active runtime

- Draft acceptance and every saved revision create one `draft_candidates` attempt and one
  `build_candidate` job with a preallocated immutable version ID.
- The worker compiles once, materializes preview/public ReaderShell pages from the same rendered
  page stream, writes incremental manifest/search spools, durably renames the candidate tree and
  atomically registers candidate, version, search, presentation and job state.
- Publish performs policy and compare-and-swap checks, then synchronously promotes that exact ready
  version. Repeating the same publish is idempotent and creates neither a version nor an audit event.

## Deleted runtime paths

- `src/modules/publishing/adapters/filesystem/build-version.ts`
- `src/modules/publishing/adapters/filesystem/finalize-version.ts`
- `src/modules/publishing/adapters/filesystem/preview-identity.ts`
- `src/modules/publishing/adapters/filesystem/search-spool.ts`
- `src/modules/publishing/adapters/reader-html/materialize-version-pages.ts`
- `src/modules/publishing/adapters/worker/build-preview.ts`
- `src/modules/publishing/adapters/worker/build-publish.ts`
- `src/modules/publishing/adapters/worker/preview-artifact.ts`
- `src/modules/publishing/adapters/worker/preview-finalization.ts`
- `src/modules/publishing/adapters/worker/preview-pages.ts`
- `src/modules/publishing/application/commands/queue-publish-build.ts`
- `src/modules/publishing/application/crash-points.ts`

Obsolete preview/publication parity, version-builder, stale-preview and old recovery/crash tests were
deleted with those implementations. No absence-only test replaces them.

## Retained current paths

- `candidate-assembly.ts` owns the single validated input/resource/version assembly path and requires
  a candidate page materializer; it has no default renderer or legacy search-spool fallback.
- `candidate-materializer.ts` owns the only preview/public page materialization path.
- `candidate-search-spool.ts` reads the current incremental NDJSON candidate search output.
- `draft-artifacts.ts` reads the current ready candidate preview/config/diagnostic artifacts for
  authenticated management routes.
- Preview HTTP routes remain because they serve the ready candidate; they do not build artifacts.
- `publication.ts` remains only for making a book non-public. Candidate promotion is exclusively in
  `candidate-publication.ts`.
- Older JSON reports under `docs/audits/` remain historical evidence even when they contain deleted
  job or identity names; they are not imported by product or benchmark runtime.

## Verification

- Vitest: 117 files, 621 tests passed.
- Typecheck, lint/architecture and production Web/worker/CLI build passed; the source graph reported
  zero diagnostics.
- A one-page production-worker smoke completed upload through synchronous publication in 1.632 s;
  publish-to-public was 0.883 ms.
- The current source regenerated all fifteen observed reference files; comparison against reference
  v2 was 15/15 exact with zero issues.
- The production worker completed all fifteen real ZIPs: total wall 592.377 s, accepted-to-preview
  589.626 s, slowest book 81.873 s, candidate-build total 119.924 s and all publish transitions
  18.237 ms. Maximum isolated process-tree RSS was 2,258,821,120 bytes.
- Against the frozen 901.234 s aggregate and 153.23 s slowest-book observation, this cutover run is
  34.27% faster in aggregate and 46.57% faster for the slowest book. Formal paired AB/BA/AB evidence
  remains a later 008 gate.
