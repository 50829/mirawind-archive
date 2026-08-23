# Quickstart: Architecture Closure Validation

## Prerequisites

- Node.js 24 and pnpm 11.9
- dependencies installed from the frozen lockfile
- Linux for production process-tree RSS evidence
- private real fixtures only for final reference/performance gates

## 1. Static Boundaries

```bash
pnpm architecture:imports
pnpm architecture:check
pnpm test:architecture
```

Expected: zero file-level or module-level cycles and zero forbidden imports. The legal-public-import
module-cycle fixtures must fail inside their negative assertions.

## 2. Focused Worker And Observation Evidence

```bash
pnpm vitest run --project unit \
  tests/unit/observability/attempt-observation.test.ts \
  tests/unit/observability/metrics.test.ts \
  tests/unit/platform/process-tree-rss.test.ts \
  tests/unit/worker/protocol.test.ts \
  tests/unit/publishing/render-pages.test.ts

pnpm vitest run --project integration \
  tests/integration/recovery/job-repository.test.ts \
  tests/integration/recovery/worker-leases.test.ts \
  tests/integration/recovery/child-termination.test.ts \
  tests/integration/recovery/retry-policy.test.ts \
  tests/integration/recovery/worker-health.test.ts \
  tests/integration/publication/candidate-builder.test.ts \
  tests/integration/deletion/book-deletion-service.test.ts
```

Expected: monotonic progress, one terminal owner, queue snapshots, stage durations, nullable RSS,
one running job, four-page limit, process-group termination and existing atomic transitions pass.

## 3. Health Contract

Run the local Web and worker, queue representative work and query the authenticated management health
endpoint. Verify private/no-store headers and strict queue/current/recent attempt fields. Stop the
child during a stage and verify the last entered stage and RSS availability remain visible without
private names or paths.

## 4. Repository Gates

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

## 5. Correctness And Performance

Use the existing reference and benchmark commands from feature 008 with a declared representative
subset during development and all fifteen fixtures for final acceptance. Expected: reference exact,
no book wall regression over `max(5%, 1 s)`, no RSS regression over `max(5%, 64 MiB)`, reading p95 at
most 300 ms and search p95 below 1,000 ms during overlapping background work.
