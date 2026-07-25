# M2a library release verification

- Verified: 2026-07-25
- Base commit: `00328739763da11e79c314ff916300a96f776edb`
- Runtime: Node.js 24.15.0, pnpm 11.9.0
- Result: **PASSED**

All final commands below exited zero against the current feature worktree.

| Gate                   | Exact command                                                                                                                                                                      | Result                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Formatting             | `pnpm format`                                                                                                                                                                      | all configured files matched                                       |
| Lint                   | `pnpm lint`                                                                                                                                                                        | passed                                                             |
| Astro and TypeScript   | `pnpm typecheck`                                                                                                                                                                   | 262 files; 0 errors, warnings or hints                             |
| Unit tests             | `pnpm test:unit`                                                                                                                                                                   | 17 files; 72 tests passed                                          |
| Integration tests      | `pnpm test:integration`                                                                                                                                                            | 48 files; 222 tests passed                                         |
| Contract tests         | `pnpm test:contract`                                                                                                                                                               | 10 files; 40 tests passed                                          |
| Browser tests          | `MIRAWIND_E2E_PORT=4322 pnpm test:e2e`                                                                                                                                             | 9 production-stack journeys passed                                 |
| Production build       | `pnpm build`                                                                                                                                                                       | Astro server plus worker and CLI artifacts built                   |
| Library performance    | `pnpm benchmark:library --requests 30 --warmups 5 --concurrency 4 --output-json docs/audits/m2a-library-performance.json --output-markdown docs/audits/m2a-library-performance.md` | 1,000 books; library p95 239.527 ms; details p95 21.927 ms         |
| Migration and recovery | `pnpm audit:migration-recovery --source-data-root <disposable-schema-6-real-MinerU-copy> --output docs/audits/m2a-library-migration-recovery-report.md`                            | migrations 1–6, backup/restore and corrupt-current rollback passed |

The browser matrix covers anonymous discovery, direct and enhanced details, close control,
Escape and browser Back restoration, focus and scroll restoration, search-result
navigation, previous/next and guarded arrow-key navigation, all four 360-pixel reader
drawers, no-JavaScript navigation, publish success/failure continuity, visibility
transition and serious/critical axe findings.

## Performance defect resolved

The first final performance rerun found that direct details rendered all 1,000 library cards
behind its modal and produced a 398.464 ms p95. The details backdrop now requests a bounded
12-entry library summary while `/library` retains the complete public collection. Focused
tests, typecheck, build, the full release gates and the benchmark passed after the change.

## Recovery evidence

The migration audit copied a registered dual-version MinerU fixture before mutation, applied
migration 6 to the disposable copy, then exercised the standard audit. SQLite integrity,
foreign keys, logical backup identity, corrupt-current detection, superseded-version
promotion, public pointer availability and the recovery audit event all passed. The source
fixture was not modified.
