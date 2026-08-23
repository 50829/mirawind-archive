# Tasks: Architecture Closure

**Input**: Design documents from `/specs/013-architecture-closure/`

**Prerequisites**: D-123, spec.md, plan.md, research.md, data-model.md, contracts/ and checklists/

**Tests**: Architecture, worker lifecycle, progress, observability, authorization, recovery,
publication, deletion, reference exactness and performance evidence are mandatory because this
feature changes constitution-critical boundaries.

## Phase 1: Setup And Governance

**Purpose**: Freeze the approved boundary and evidence requirements before source changes.

- [x] T001 Record D-123 in `docs/decisions/decision-log.md` and synchronize worker observation
      behavior in `docs/product/product-spec.md`.
- [x] T002 Create the feature 013 specification, plan, research, data model, contracts, quickstart and
      requirements checklists under `specs/013-architecture-closure/`.
- [x] T003 Record the current architecture graph, cross-module edges, worker/server composition
      inventory and focused baseline commands in `specs/013-architecture-closure/evidence.md`.

---

## Phase 2: Foundational Evidence

**Purpose**: Add failing evidence for the hidden module cycle, worker observations and lifecycle
boundaries before moving production responsibilities.

- [x] T004 [P] Add two-module and longer legal-public-surface cycle fixtures plus composition-business-
      SQL fixtures in `tests/fixtures/architecture/` and failing assertions in
      `tests/architecture/dependency-graph.test.ts`.
- [x] T005 [P] Add failing same-phase progress regression, total/unit mutation and phase-order tests in
      `tests/integration/recovery/job-repository.test.ts` and `tests/unit/worker/protocol.test.ts`.
- [x] T006 [P] Add failing queue empty/queued/running/draining and future-timestamp tests in
      `tests/integration/recovery/job-repository.test.ts`.
- [x] T007 [P] Add failing monotonic stage, repeated-phase, retry isolation and all-terminal-outcome
      tests in `tests/unit/observability/attempt-observation.test.ts`.
- [x] T008 [P] Add Linux process-tree child/grandchild, rapid-exit, unavailable and tree-bound tests in
      `tests/unit/platform/process-tree-rss.test.ts`.
- [x] T009 [P] Add failing strict-schema, size, atomic mode, refresh/coalescing, unversioned/unknown-v2
      clean-switch, write-failure non-interference and sensitive-field tests in
      `tests/fixtures/worker-health/`, `tests/integration/recovery/worker-health.test.ts` and
      `tests/unit/observability/redaction.test.ts`.
- [x] T010 Add attempt completion tests covering success, content failure, cancellation, timeout,
      shutdown and lease loss with exactly one terminal transition in
      `tests/integration/recovery/worker-attempt.test.ts`.

**Checkpoint**: New evidence fails for missing behavior while all pre-existing behavior remains green.

---

## Phase 3: User Story 1 - Declared Acyclic Module Boundaries (Priority: P1)

**Goal**: A maintainer changes one business module through a narrow public operation with no module
cycle, duplicated lifecycle query or excess cleanup authority.

**Independent Test**: The architecture graph is acyclic at file and module granularity; presentation,
cleanup and recovery behavior passes through declared owners with unchanged results.

- [x] T011 [US1] Extend `scripts/architecture/dependency-graph.ts` and
      `scripts/architecture/boundaries.ts` with module aggregation, module SCC diagnostics and
      composition business-SQL detection until T004 passes.
- [x] T012 [US1] Define Catalog-owned bounded presentation input/construction in
      `src/modules/catalog/application/book-version-presentation.ts` and move Publishing format
      interpretation into `src/modules/publishing/application/publication-formats.ts`.
- [x] T013 [US1] Move presentation reconciliation candidate enumeration from
      `src/modules/catalog/adapters/sqlite/book-presentations.ts` to
      `src/modules/publishing/adapters/sqlite/versions.ts`, then update
      `src/modules/catalog/adapters/filesystem/book-presentation.ts` and
      `src/composition/storage-reconciliation.ts` to compose the two owners.
- [x] T014 [US1] Remove Catalog-to-Publishing imports and the external `BookVersionRecord` export from
      `src/modules/catalog/`, `src/modules/publishing/application/public.ts` and affected composition
      consumers, then pass presentation unit/integration evidence.
- [x] T015 [US1] Split cancellation, removal inventory and record purge capabilities in
      `src/modules/catalog/application/ports/book-publishing-cleanup.ts`, update
      `src/modules/publishing/adapters/sqlite/book-cleanup.ts` and inject least-authority ports in
      Catalog deletion use cases.
- [x] T016 [US1] Move current-version verification reads and recovery mutations out of
      `src/composition/version-verification.ts` and `src/composition/verify-version-job.ts` into narrow
      Catalog and Publishing application operations/adapters while preserving the shared immediate
      transaction.
- [x] T017 [US1] Narrow Reader's Publishing surface in
      `src/modules/publishing/application/public.ts`,
      `src/modules/reader/application/public.ts` and
      `src/modules/reader/adapters/filesystem/version-artifact-index.ts` to renderer assets and a
      bounded manifest projection.
- [x] T018 [US1] Run architecture, presentation, deletion and version-recovery suites and record zero
      module cycles/cross-owner SQL in `specs/013-architecture-closure/evidence.md`.

**Checkpoint**: The business-module graph is acyclic and each cross-module mutation has one narrow owner.

---

## Phase 4: User Story 2 - Focused Orchestration Responsibilities (Priority: P1)

**Goal**: Task and HTTP composition can be understood and tested by responsibility instead of through
oversized assembly modules.

**Independent Test**: One job traverses capture, execution and completion through one path; server
routes import focused roots and no compatibility barrel remains.

- [x] T019 [US2] Split `src/composition/server.ts` into focused roots under
      `src/composition/server/` for catalog, identity, reader, publishing drafts/imports/jobs and
      publication, then update all `src/pages/` and `src/http/` consumers and delete the old barrel.
- [x] T020 [US2] Extract frozen command capture from `src/composition/worker.ts` to
      `src/composition/worker/capture-frozen-input.ts` with bounded repository inputs.
- [x] T021 [US2] Extract subject preflight and child lifetime handling to
      `src/composition/worker/execute-attempt.ts`, returning a bounded outcome without terminal writes.
- [x] T022 [US2] Extract generic, candidate and purge terminal interpretation to
      `src/composition/worker/complete-attempt.ts`, preserving candidate registration and deletion
      transactions.
- [x] T023 [US2] Extract retry and expired-lease composition to
      `src/composition/worker/recover-attempts.ts` and reuse it from startup and the live loop.
- [x] T024 [US2] Reduce `src/composition/worker.ts` to bootstrap and move serial claim/checkpoint/
      execute/observe control into `src/composition/worker/loop.ts`; replace bootstrap's direct version
      SQL with a Publishing startup verification scheduling operation without changing one-job behavior.
- [x] T025 [US2] Replace the manual child kind chain in `src/composition/job-child.ts` with the existing
      exhaustive `src/entrypoints/worker/job-registry.ts` and focused handlers under
      `src/composition/worker-child/handlers/`, leaving IPC bootstrap only.
- [x] T026 [US2] Run worker attempt, leases, child termination, retry, candidate registration and
      deletion suites and record the single execution/terminal path in
      `specs/013-architecture-closure/evidence.md`.

**Checkpoint**: Composition contains wiring and process control, not business SQL or duplicated lifecycle policy.

---

## Phase 5: User Story 3 - Queue, Stage And RSS Observability (Priority: P1)

**Goal**: Operators can see current queue pressure, meaningful attempt stages and process-tree memory
through one bounded private health snapshot.

**Independent Test**: Queue transitions and representative terminal attempts produce a strict private
snapshot with real stage durations and peak-or-unavailable RSS, without sensitive data or log spam.

- [x] T027 [US3] Implement `QueueObservation` and defensive monotonic progress validation in
      `src/modules/publishing/application/job-state.ts` and
      `src/modules/publishing/adapters/sqlite/jobs.ts` until T005-T006 pass.
- [x] T028 [P] [US3] Implement bounded nullable Linux process-tree sampling in
      `src/platform/process/process-tree-rss.ts` and update the existing benchmark sampler in
      `scripts/benchmarks/build.ts` to reuse it.
- [x] T029 [P] [US3] Implement monotonic current/recent attempt and contiguous stage models in
      `src/observability/attempt-observation.ts` until T007 passes.
- [x] T030 [US3] Extend `ChildExecution` and `runJobChild()` in
      `src/entrypoints/worker/child-runner.ts` with 250 ms non-overlapping process-tree sampling and a
      nullable peak, preserving protocol v4 and termination behavior.
- [x] T031 [US3] Move existing analyze, prepare and candidate phase notifications to their real entry
      points in `src/modules/publishing/adapters/worker/`,
      `src/modules/publishing/adapters/filesystem/build-candidate-version.ts` and focused child handlers.
- [x] T032 [US3] Implement the sole schema-v2 atomic private health writer, strict parser, one-second
      coalescing and five/60-second refresh limits in
      `src/composition/worker/health-reporter.ts` and `src/observability/worker-health.ts`.
- [x] T033 [US3] Feed queue, stage, terminal, checkpoint and memory observations through
      `src/composition/worker/loop.ts`, `src/composition/worker/execute-attempt.ts` and
      `src/entrypoints/worker/checkpoint.ts` without adding a second health writer.
- [x] T034 [US3] Expose the strict worker snapshot through the existing authenticated private/no-store
      `src/pages/api/manage/health.ts` response and add safe structured worker events through
      `src/observability/logger.ts`.
- [x] T035 [US3] Pass observation, health, hostile/private-data absence and authenticated cache-policy
      tests, then document the health fields and unavailable semantics in
      `docs/operations/deployment.md` and `docs/operations/recovery.md`.

**Checkpoint**: Queue, stage and RSS observations are accurate, bounded, private and available across processes.

---

## Phase 6: User Story 4 - Preserve Bounded Recoverable Execution (Priority: P1)

**Goal**: Readers and operators retain all concurrency, timeout, recovery and immutable publication
guarantees after the structural changes.

**Independent Test**: Stress and failure injection retain one running task, four in-flight pages,
process-group termination, previous-version availability and accepted performance tolerances.

- [x] T036 [US4] Extend `tests/integration/recovery/child-termination.test.ts` and
      `tests/e2e/worker-recovery.spec.ts` with phase/RSS evidence across cooperative exit, SIGKILL,
      shutdown and unavailable sampling while retaining complete process-tree termination.
- [x] T037 [US4] Run and preserve `tests/unit/publishing/render-pages.test.ts`, worker lease/retry,
      candidate crash-boundary, deletion interruption, authorization, hidden-404 and cache contract
      suites; record results in `specs/013-architecture-closure/evidence.md`.
- [x] T038 [US4] Run a declared representative reference-exact development workload with observations
      enabled and compare wall/RSS against the accepted baseline in
      `specs/013-architecture-closure/evidence.md`.
- [x] T039 [US4] Run concurrent reader/search benchmarks during background work and record p95 against
      the 300/1,000 ms gates in `specs/013-architecture-closure/evidence.md`.

**Checkpoint**: Structural and observation changes remain behavior-, correctness- and performance-neutral.

---

## Phase 7: Validation And Convergence

**Purpose**: Complete repository gates and synchronize all artifacts with the delivered architecture.

- [x] T040 Run Prettier over feature and changed files, then run `pnpm format`, `pnpm lint`,
      `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` and `pnpm build`; record exact results in
      `specs/013-architecture-closure/evidence.md`.
- [x] T041 Run the full fifteen-book reference-v2 comparison and required performance confirmation,
      with all registered private fixtures present and exact, and record the result in
      `specs/013-architecture-closure/evidence.md`; the feature remains incomplete if this gate cannot run.
- [x] T042 Resolve every unchecked item in
      `specs/013-architecture-closure/checklists/architecture-observability.md` against the final
      artifacts and update the checklist with references.
- [x] T043 Run Spec Kit analyze with no unmitigated CRITICAL findings, then run converge and implement
      every appended task in `specs/013-architecture-closure/tasks.md`.
- [x] T044 Synchronize `docs/architecture/m1-architecture.md`, runtime operations docs and feature 013
      tasks/evidence with the final implementation.

---

## Dependencies And Execution Order

- Phase 1 precedes all source changes.
- Phase 2 evidence precedes the corresponding implementation.
- US1 establishes an acyclic owner graph before US2 moves composition files.
- US2 establishes the single attempt path before US3 attaches observation.
- US3 precedes US4 performance and recovery confirmation.
- All user stories precede repository-wide validation and convergence.

## Parallel Opportunities

- T004-T009 edit independent fixture/test areas and can proceed in parallel after T003.
- T028 and T029 are independent platform and pure observation models after foundational tests.
- Focused architecture/presentation and process-memory/observation tests can run concurrently after
  their source batches settle; shared composition and worker source edits remain sequential.

## Implementation Strategy

The first usable increment is US1: the module graph becomes honestly acyclic and ports have least
authority. US2 then changes only assembly locations while preserving behavior. US3 attaches
observations to the new single attempt path, and US4 proves the existing runtime guarantees. No
compatibility implementation or alternate worker path is retained between increments.

---

## Phase 8: Convergence

- [x] T045 Split `src/composition/server/publishing.ts` into direct draft, import, job and publication
      composition roots and update consumers without retaining an aggregate factory per plan Design 3
      and FR-004 (partial).
- [x] T046 Refactor `src/composition/worker/execute-attempt.ts` to return a bounded child execution
      outcome without terminal writes, and make `src/composition/worker/complete-attempt.ts` the only
      live-attempt result/terminal coordinator per FR-004, FR-005 and orchestration contract
      (contradicts).
