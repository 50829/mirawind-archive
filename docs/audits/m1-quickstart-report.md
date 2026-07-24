# M1 Quickstart acceptance report

- Executed: 2026-07-25
- Guide: `specs/001-mineru-public-publishing/quickstart.md`
- Result: **PASSED**

## Command evidence

The acceptance run used the pinned Node 24/pnpm 11.9 environment and the production build:

| Command                                                             | Result                                                                        |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `corepack enable`                                                   | passed                                                                        |
| `pnpm install --frozen-lockfile`                                    | passed; lockfile unchanged                                                    |
| `pnpm build`                                                        | passed; Astro server, worker and CLI artifacts produced                       |
| `node dist/processes/cli/index.js db migrate`                       | passed on a new private temporary data root; migrations 1–5 applied           |
| `pnpm fixtures:verify-real --dir "$PWD/tests/fixtures/mineru/real"` | passed; both registered MinerU 3.4.4 fixture sizes and SHA-256 values matched |
| `pnpm test:integration -- archive import`                           | passed; 43 files, 190 tests                                                   |
| `pnpm test:integration -- publication recovery`                     | passed; 43 files, 190 tests                                                   |
| `pnpm test:integration -- auth cache download`                      | passed; 43 files, 190 tests                                                   |
| `pnpm test:contract`                                                | passed; 8 files, 33 tests                                                     |
| `pnpm test:integration -- schema reproducibility`                   | passed; 43 files, 190 tests                                                   |
| `pnpm benchmark:reference ...`                                      | passed for both real fixtures and the stress fixture                          |
| `pnpm lint`                                                         | passed                                                                        |
| `pnpm typecheck`                                                    | passed; 233 Astro/TypeScript files, no diagnostics                            |
| `pnpm test`                                                         | passed; 63 files, 280 tests                                                   |
| `pnpm test:e2e`                                                     | passed; 3 Chromium production-stack journeys                                  |

The integration commands retain their human-readable Quickstart grouping, but Vitest runs
the complete integration project for each invocation. The resulting coverage is a superset
of each named group.

## Scenario evidence

- The production browser journeys imported high-confidence and confirmation-required
  MinerU packages, edited all M1 structure overrides, published immutable versions, read and
  searched them anonymously, protected private resources, preserved the old version across
  a failed rebuild, and canceled/retried/recovered durable work.
- Archive tests cover traversal, normalization collisions, links and special files,
  malformed archives, streaming limits, ZIP expansion ratios, image limits and cleanup.
- Publication/recovery tests cover rename, transaction and pointer crash boundaries,
  worker leases, termination, retry ceilings, reconciliation, rollback and retention.
- Authorization tests cover anonymous/admin and public/private/draft/current/old/ready/
  nonexistent combinations before ETag and Range evaluation.
- Contract and reproducibility tests cover strict schemas, every migration, semantic
  cross-references and deterministic version outputs.
- Original-download tests cover a sparse 2 GiB file, conditional and byte-range responses,
  interrupted/resumed byte identity and immediate private denial.
- The reference benchmark drove the built Web and worker artifacts for both registered
  MinerU 3.4.4 books and the 500-page stress book. All idle/concurrent-build read and
  normal/short search p95 measurements passed. Exact values are in
  `docs/audits/m1-performance-report.md`.

## Intentional interactive deviation

The real `admin bootstrap` command was not fed a password by automation because credentials
must never appear in command arguments, environment, logs or tool transcripts. Its
production CLI artifact was built, its migration prerequisite was executed directly, and
the bootstrap/recovery behavior is covered by the integration CLI suite with injected
non-logging prompts. Final deployment still requires the administrator to execute the
documented command in a private TTY.

The production `start` and `worker` entry points were exercised by the browser and reference
benchmark harnesses with isolated data roots. No persistent development server was left
running.

## Execution note

An initial benchmark attempt overlapped a Playwright-triggered rebuild of `dist` because the
outer command yielded before the benchmark subprocess exited. That attempt failed during a
rebuild and did not overwrite the prior passing report. After confirming there were no
residual Web/worker processes or listeners, the exact benchmark was rerun alone in a fresh
private directory and exited zero with every fixture passed. This was an acceptance-run
orchestration error, not a product-code failure.
