# M1 User Story 4 worker and recovery evidence

Date: 2026-07-25

## Result

User Story 4 passes against the production Web/worker process model and disposable SQLite
WAL storage. Durable jobs expose safe status, cancellation and immutable retries; expired
leases recover within the approved one-automatic-retry boundary; task children terminate as
whole process groups; startup reconciliation preserves the last verified publication; and
retention, checkpoint and health operations do not move the current-version pointer.

The two registered MinerU 3.4.4 fixtures are available for the Phase 7 compatibility and
performance gate. This checkpoint establishes worker and recovery behavior but does not
claim the final real-book latency targets.

## Automated evidence

- `pnpm exec vitest run --project contract tests/contract/jobs.contract.test.ts` — 1 file
  and 2 tests passed.
- `pnpm exec vitest run --project integration
tests/integration/recovery/worker-leases.test.ts
tests/integration/recovery/child-termination.test.ts
tests/integration/recovery/retry-policy.test.ts
tests/integration/recovery/reconciliation.test.ts
tests/integration/recovery/retention.test.ts
tests/integration/storage/wal-operations.test.ts` — 6 files and 23 tests passed.
- `pnpm test` — all 59 Vitest files and 263 tests passed.
- `pnpm test:e2e` — all 3 Chromium production-stack journeys passed in 24.7 seconds. The
  worker journey stopped the original worker, created an expired lease and a queued job,
  canceled and explicitly retried the queued job, restarted a separate worker, observed the
  bounded automatic retry and verified the unchanged publication pointer.
- `pnpm format`, `pnpm typecheck`, `pnpm lint`, and `pnpm build` — passed after the final
  worker/E2E correction.
- A focused child-termination run left no `stubborn-job-child.mjs` process or grandchild
  alive after completion.

## Covered behavior

- Two independent worker connections contend through one real SQLite file; only one job is
  claimed globally, heartbeats extend the lease, and expired leases become interrupted.
- Job status returns bounded phase/progress values and safe failure class/code fields without
  raw archive paths or private content.
- Queued and running cancellation requests are durable. Explicit retry creates a new
  immutable attempt linked to the prior row instead of rewriting history.
- Infrastructure interruption can produce exactly one automatic retry. Content, validation,
  security-limit, timeout and repeated interruption failures require an administrator retry.
- Each job runs in a detached child process group. Cancellation or timeout sends the
  cooperative cancel message and `SIGTERM`, waits the frozen 10-second production grace,
  escalates the whole group to `SIGKILL`, and records terminal state only after `close`.
- Worker startup recovers expired leases, cleans stale staging, inventories immutable version
  directories and database rows, quarantines orphans, verifies current versions and enqueues
  retention without publishing a `ready` version.
- A corrupt current version rolls back only to the newest verified, previously published,
  unreclaimed predecessor. Without such a predecessor, only that book becomes temporarily
  unavailable.
- Retention always preserves the current and previous verified versions, waits at least
  24 hours for older versions and quarantine entries, removes version-scoped search rows
  transactionally and retries filesystem residue without changing publication state.
- The worker owns scheduled passive WAL checkpoints. Web writes use the approved bounded busy
  timeout, startup retries WAL recovery, and explicit restart/truncate modes remain
  maintenance-only.
- The authenticated health endpoint is `private, no-store` and reports bounded lease, WAL,
  worker-health, disk and percentile metrics without credentials, paths or private content.

## Defect found by the production journey

The recovery journey initially compared retry rows in a business order while SQLite sorted
their opaque randomly generated parent IDs lexically. Both retries had succeeded, but the
test waited for an impossible array order. The assertion now keys results by immutable parent
job ID, preserving the behavior check without depending on opaque-ID ordering.
