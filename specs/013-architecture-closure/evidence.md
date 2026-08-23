# Evidence: Architecture Closure

## Baseline

Date: 2026-08-23

- Git branch: `main`
- Product source files in architecture graph: 260
- Current cross-module direction includes both Catalog -> Publishing and Publishing -> Catalog even
  though the file-level graph reports no cycle.
- `src/composition/worker.ts`: 865 lines; owns frozen input, heartbeat, child execution, subject
  finalization, terminal transitions, retry/recovery, loop, startup and metrics.
- `src/composition/job-child.ts`: 431 lines; owns IPC, profiling, progress, error mapping and all seven
  task-kind handlers.
- `src/composition/server.ts`: 224 lines; exposes Catalog, Publishing, Reader and Identity assembly and
  unbound publishing filesystem actions.
- Worker `OperationalMetrics` is process-local and is not the instance read by the Web health route.

## Baseline Commands

```text
pnpm architecture:imports                         PASS, 0 replacements
pnpm architecture:check                           PASS, 260 files, 0 diagnostics
pnpm test:architecture                            PASS, 13 tests
focused worker/recovery integration baseline      PASS, 22 tests
focused metrics/protocol/render-page unit baseline PASS, 13 tests
```

The baseline is diagnostic only. It proves existing tests are green before the new module-level,
attempt-observation and worker-health requirements are introduced.

## Implementation Evidence

### Module Boundaries

- Architecture graph now checks file SCCs, aggregated business-module SCCs and composition-owned
  business SQL.
- Negative architecture fixtures: 15 boundary fixtures pass; complete product source reports zero
  diagnostics.
- Catalog has zero source imports from Publishing. Presentation artifact interpretation and version
  candidate enumeration belong to Publishing; Catalog retains the presentation DTO and sole writer.
- Book cleanup now exposes separate cancellation, removal-inventory and record-purge ports.
- Current-version recovery composes Catalog current-pointer updates with Publishing version-state
  updates in the existing immediate transaction; composition contains no business SQL.
- Reader consumes bounded renderer assets and a reader manifest projection.

Focused evidence:

```text
architecture                                   PASS, 16 tests
presentation unit                              PASS, 3 tests
presentation recovery + candidate registration PASS, 13 tests
deletion                                       PASS, 12 tests
storage/retry/candidate recovery                PASS, 25 tests
```

### Composition And Worker Observations

- `src/composition/worker.ts` reduced from 865 lines to a 10-line entry shell.
- Worker responsibilities are split across capture (99), lifecycle (187), execution (347), recovery
  (45), loop (133), health reporting (116) and bootstrap (143) line modules.
- `src/composition/job-child.ts` reduced from 431 to 162 lines; seven task kinds dispatch through the
  exhaustive registry into Publishing and maintenance handlers.
- `src/composition/server.ts` was deleted; consumers import Catalog, Publishing, Reader or Identity
  roots directly.
- Publishing server composition is further split into direct draft, import, job and publication roots;
  no aggregate Publishing factory or forwarding export remains.
- `executeWorkerAttempt` returns only a bounded child outcome. `completeWorkerAttempt` is the single
  live path that interprets results, finalizes artifacts and commits terminal state; an integration
  test proves the job remains running between those calls.
- Queue observation and same-phase progress validation live in Publishing application/storage.
- Parent child-runner samples Linux child/descendant RSS every 250 ms and returns nullable peak
  evidence without changing IPC v4.
- The sole worker health reporter writes strict v2 with checkpoint, queue and current/recent attempt;
  the authenticated health route strictly parses the derived file.

Focused post-refactor evidence:

```text
TypeScript Web + worker                         PASS
architecture                                   PASS, 16 tests
worker/import/preview/health integration        PASS, 27 tests
attempt terminal coordinator                    PASS, 5 tests
observability/protocol/render concurrency        PASS, 20 tests
```

Post-convergence attempt lifecycle evidence: `20/20` focused attempt/termination/retry tests pass.

### Real Fixture Correctness And Performance

- Fixture registry: 15 MinerU 3.4.4 ZIPs, hashes verified.
- Fresh current observed-v2 against immutable reference-v2: `15/15 exact`, zero issues.
- Full final candidate pipeline: 15/15 succeeded; total wall `449,386.536 ms`, accepted-to-preview
  `443,608.163 ms`, publish-to-public total `47.061 ms`, peak process-tree RSS `1,216,323,584` bytes.
  This full run is correctness/shape evidence; the historical environment fingerprint differs and is
  not used for regression percentages.
- Same-host, same-session focused A/B used detached baseline commit `8bd2df1` and the current dirty
  candidate in the fixed order 97/441/583 pages. All results stayed within
  `max(5%, 1 s)` wall and `max(5%, 64 MiB)` RSS tolerances:

| Fixture        | Baseline wall ms | Candidate wall ms | Wall delta ms |  Baseline RSS | Candidate RSS | Result |
| -------------- | ---------------: | ----------------: | ------------: | ------------: | ------------: | ------ |
| `b309a572298b` |       16,537.140 |        17,332.881 |      +795.741 |   692,244,480 |   640,663,552 | PASS   |
| `e80477ff22ac` |        5,535.357 |         5,494.112 |       -41.245 |   313,798,656 |   313,823,232 | PASS   |
| `a53faf7243d4` |       27,636.769 |        26,873.431 |      -763.338 | 1,235,185,664 | 1,203,376,128 | PASS   |

The first final `b309` run exceeded its one-second wall tolerance by `55.908 ms`; D-118 therefore
triggered two additional candidate-only runs. The accepted three-run median shown above is
`17,332.881 ms`, within tolerance, and its median RSS remains `51,580,928` bytes below baseline.

- Reader/search reference HTTP evidence passed for those three real fixtures and the 500-page stress
  fixture. Every branch used concurrency 8; idle/search branches used 200 requests and each
  concurrent-build read branch used 500 requests while observing a running candidate.
- Maximum idle read p95: `41.470 ms`; concurrent-build read p95: `33.655 ms` (gate `300 ms`).
- Maximum normal search p95: `129.457 ms`; short search p95: `132.104 ms` (gate `1,000 ms`).
- Every publication pointer advanced only after its overlapping candidate completed.

Ignored raw evidence SHA-256:

- full final candidate: `ec1a1d26412a75e82f2954c5b863cbe5317b05c6d809109fda448908e0b580fa`
- focused baseline: `d8cf5551801ea0ca690162d66a866a75282af08616be104af73c6a412d28384b`
- focused final candidate: `87ef74103283fa4888a636ffa41dadaaaf6053cc6e2e5a054027a8c64f327c8f`
- focused `b309` supplemental runs: `e5b103eac0ce8872ab7c1db4556db3734dce7a44362e25e505b2bf2708fdec09`
- final reference HTTP: `2346df081e68d7f16ba2b62d7d512e23f7fe52794426f153ead4ddf6beb46be3`

Current environment fingerprint: `e3852ad775ba7d4a35a26207e41a63c6d030f9671c21f1722d34daaa95632384`.

### End-To-End

- Playwright Chromium 1.61 cache was installed after the initial environment-only launch failure.
- Full E2E on alternate port 4322: 23 passed, 3 conditional skips, including worker recovery and
  strict health v2 queue/stage/RSS assertions.

### Final Repository Gates

```text
pnpm format      PASS
pnpm lint        PASS; 284 product files, zero architecture diagnostics
pnpm typecheck   PASS; Astro/TypeScript Web and worker, zero diagnostics
pnpm test        PASS; 121 files, 698 tests after convergence
pnpm test:e2e    PASS; 23 passed, 3 conditional skips on port 4322
pnpm build       PASS; Astro server, CLI, worker and job-child bundles
```

The first E2E attempt could not launch because port 4321 belonged to the existing Docker preview and
the Playwright Chromium cache was absent. The existing service was left untouched; the locked
Chromium build was installed and all three successful full runs used port 4322. A production-bundle worker
crash found during the first browser run (`performance.now` called without its receiver) was fixed and
covered by a default-clock unit test before both successful runs.

## Spec Kit Closure

- Final analyze: 32 FR/NFR/SC buildable requirements covered; 46 tasks mapped; zero CRITICAL/HIGH
  consistency findings.
- First converge appended T045-T046 for the remaining aggregate Publishing server and mixed
  execute/complete responsibility.
- T045-T046 were implemented with focused and full regression evidence.
- Second converge: zero remaining gaps; no additional tasks appended.
