# M1 release verification

- Verified: 2026-07-25
- Code commit: `baff029949a7fd7bd39025fae12d3f70ec800b86`
- Runtime: Node v24.15.0, pnpm 11.9.0
- Result: **PASSED**

The final release run started from a clean worktree and used the frozen lockfile. All
commands below exited zero against the code commit above.

| Gate                       | Exact command                                                                                                                          | Result                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Frozen dependency install  | `pnpm install --frozen-lockfile`                                                                                                       | already current; lockfile unchanged          |
| Commit history             | `for commit_oid in $(git rev-list --reverse HEAD); do git show -s --format=%B "$commit_oid" \| pnpm exec commitlint \|\| exit 1; done` | all 51 commits passed                        |
| Formatting                 | `pnpm format`                                                                                                                          | all configured files matched                 |
| Lint                       | `pnpm lint`                                                                                                                            | passed                                       |
| Type and Astro diagnostics | `pnpm typecheck`                                                                                                                       | 233 files; 0 errors, warnings or hints       |
| Unit tests                 | `pnpm test:unit`                                                                                                                       | 12 files, 57 tests passed                    |
| Integration tests          | `pnpm test:integration`                                                                                                                | 43 files, 190 tests passed                   |
| Contract tests             | `pnpm test:contract`                                                                                                                   | 8 files, 33 tests passed                     |
| Browser tests              | `pnpm test:e2e`                                                                                                                        | 3 Chromium production-stack journeys passed  |
| Production build           | `pnpm build`                                                                                                                           | Astro server, worker and CLI artifacts built |

Additional release evidence also passed:

- `pnpm benchmark:reference ...` verified all three registered MinerU 3.4.4 fixtures and the
  synthetic stress fixture; its sanitized result and p50/p95/p99 values are in
  `docs/audits/m1-performance-results.json` and `docs/audits/m1-performance-report.md`.
- `pnpm audit:migration-recovery ...` exercised migrations, online backup/restore and
  corrupt-current rollback on a disposable representative data copy, as recorded in
  `docs/audits/m1-migration-recovery-report.md`.
- the pinned Caddy 2.10.2 image accepted `docker/Caddyfile`; contract tests freeze the
  non-root/read-only container boundary and the trusted single-value client-IP header.

## Release-gate defect resolved

The first browser preflight exposed Better Auth's fallback to one shared rate-limit bucket
when the test stack bypassed Caddy. Review found that the documented trusted `X-Real-IP`
contract was not configured at either endpoint. A failing authentication/configuration
contract was added, then Caddy was changed to overwrite `X-Real-IP` from its connection
peer and Better Auth was restricted to that header. Playwright now simulates the same proxy
contract. Focused tests, the full gate set and Caddy configuration validation all passed
after the fix; the final browser run emitted no Better Auth client-IP warning.
