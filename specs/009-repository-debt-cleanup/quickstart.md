# Quickstart: Repository Debt Cleanup Validation

## Protected local inputs

Before changes, record `git status --short`. The following must survive unchanged:

- `.env` and other ignored environment configuration;
- `tests/fixtures/mineru/real/`;
- ignored real EPUB files under `tests/fixtures/epub/`;
- the three pre-existing untracked `docs/research/` files.

Do not open or enumerate private fixture content during repository cleanup. Use registered opaque
fixture IDs for reference and build validation.

## Focused development checks

After replacing the partial job schema:

```sh
pnpm test:integration -- tests/integration/recovery/job-repository.test.ts \
  tests/integration/recovery/retry-policy.test.ts \
  tests/integration/recovery/worker-leases.test.ts
```

After each deletion/job transaction change:

```sh
pnpm test:integration -- tests/integration/deletion \
  tests/integration/recovery tests/integration/publication
pnpm test:contract -- tests/contract/jobs.contract.test.ts \
  tests/contract/build-candidate-protocol.test.ts
pnpm architecture:imports
pnpm architecture:check
```

Expected: complete production schema is used; deletion/task terminal states agree; maintenance kinds
are closed and directly serializable; candidate registration/search/presentation remains atomic; the
source graph has no diagnostic.

## Behavior and build checks

Run the standard repository checks once after source changes stabilize:

```sh
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run only the existing focused E2E flows affected by the cleanup, not the full visual suite:

```sh
pnpm test:e2e tests/e2e/worker-recovery.spec.ts \
  tests/e2e/real-publishing-loop.spec.ts
```

## Content and performance check

Use the existing fast comparator to confirm all registered references remain exact. Then build three
representative registered books selected from the established small, medium and large opaque fixture
classes using the current production pipeline benchmark. Do not run A, AB/BA/AB or a soak.

Expected:

- `15/15 exact` against reference v2;
- all three production loops complete preview and publication;
- no selected book exceeds the accepted current duration by more than `max(5%, 1 s)`;
- reader/search request code and timing instrumentation are unchanged.

Record only opaque fixture IDs, stage durations and comparison results in the tracked 009 evidence.

## Local artifact cleanup

After all evidence needed for 009 is tracked, remove ignored reproducible `.cache`, `test-results`,
generated build output and reports. Re-run `git status --short --ignored` and verify that protected
fixtures/environment files remain ignored and the three research files remain untracked.

## Final convergence

Run Spec Kit analyze before implementation and converge after final verification. Completion requires
no unmitigated CRITICAL finding, no old maintenance job path, no test-only missing-table production
branch, one presentation writer and no uncommitted 009 source/document changes.
