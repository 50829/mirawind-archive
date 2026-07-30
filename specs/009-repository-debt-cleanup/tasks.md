# Tasks: Repository Debt Cleanup

**Input**: Design documents from `/specs/009-repository-debt-cleanup/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Reuse the existing recovery, deletion, publication, contract and architecture suites. Add
only the missing transaction-state assertions; do not add absence-only, obsolete-baseline or
speculative edge-case tests.

**Organization**: Tasks are grouped by user story. The baseline/protocol switch is foundational
because deletion and status behavior both depend on the cleaned job model.

## Phase 1: Setup

**Purpose**: Preserve the current evidence and local data boundary before source changes.

- [x] T001 Record the focused deletion/recovery/architecture baseline and protected untracked paths
      in `specs/009-repository-debt-cleanup/evidence.md` without opening private fixtures.

---

## Phase 2: Foundational - One Real Task Model

**Purpose**: Remove the partial test database and clean-switch the shared task identity before
changing either deletion or status orchestration.

- [x] T002 Replace `createJobRepositorySchema()` usage with the complete migrated database helper
      and same-file second connections in `tests/integration/recovery/job-repository.test.ts`,
      `tests/integration/recovery/retry-policy.test.ts` and
      `tests/integration/recovery/worker-leases.test.ts`.
- [x] T003 Remove the test-only schema creator, table probes and missing-table branches from
      `src/modules/publishing/adapters/sqlite/jobs.ts` after T002 passes.
- [x] T004 Clean-switch the single baseline from `reclaim` to `reclaim_versions | purge_book`, update
      its identity/checksum and baseline evidence, and enforce authoritative book scope in
      `src/platform/sqlite/migrations/0001_clean_slate.sql`,
      `src/platform/sqlite/migration-manifest.ts`, `src/modules/publishing/application/job-state.ts` and
      `tests/integration/storage/migrations.test.ts`.
- [x] T005 Update the discriminated child protocol and direct external status mapping for the new
      maintenance identities in `src/entrypoints/worker/protocol.ts`,
      `src/modules/publishing/adapters/sqlite/job-status.ts` and the existing job contract tests under
      `tests/contract/` and `tests/unit/worker/protocol.test.ts`.
- [x] T006 Update maintenance dispatch, registry, child execution and scheduled reclamation in
      `src/entrypoints/worker/job-registry.ts`, `src/composition/job-child.ts`,
      `src/composition/worker.ts` and `src/modules/publishing/adapters/worker/reclaim.ts`.
- [x] T007 Update book assignment and every current book-bound task creation path to set
      `jobs.book_id` directly in `src/modules/publishing/adapters/filesystem/import-upload.ts`,
      `src/modules/publishing/adapters/filesystem/source-reprocess.ts`,
      `src/modules/publishing/adapters/worker/finalize-prepared-draft.ts`,
      `src/modules/publishing/application/commands/confirm-import-candidate.ts`,
      `src/modules/publishing/adapters/sqlite/jobs.ts` and `src/composition/worker.ts`.

**Checkpoint**: Recovery tests run on the production baseline; each maintenance task has one closed
internal identity and direct book scope.

---

## Phase 3: User Story 1 - Atomic Permanent Deletion (Priority: P1)

**Goal**: Permanent deletion success, failure, interruption, cancellation and retry update the task
and deletion tombstone coherently through one owner-aware transaction.

**Independent Test**: Run the existing deletion and recovery suites and verify every terminal and
retry path leaves matching task/deletion state while unrelated books remain available.

### Evidence for User Story 1

- [x] T008 [US1] Add only the missing atomic failure/interruption/retry assertions to
      `tests/integration/deletion/book-deletion-service.test.ts` and
      `tests/integration/deletion/permanent-book-cleanup.test.ts`, confirming they fail before the
      transaction refactor.

### Implementation for User Story 1

- [x] T009 [US1] Define the current-operation-only Publishing cleanup port and transaction inputs in
      `src/modules/catalog/application/ports/book-publishing-cleanup.ts` and export it from
      `src/modules/catalog/application/public.ts`.
- [x] T010 [US1] Implement book-scoped task cancellation, opaque removal inventory and
      Publishing-owned row purge behind the cleanup port in
      `src/modules/publishing/adapters/sqlite/book-cleanup.ts`.
- [x] T011 [US1] Reduce Catalog deletion SQL to Catalog-owned books, tombstones and presentations in
      `src/modules/catalog/adapters/sqlite/book-deletion.ts` and
      `src/modules/catalog/adapters/sqlite/book-deletions.ts`.
- [x] T012 [US1] Move deletion enqueue, terminalization and retry association out of the generic job
      repository into the Catalog deletion lifecycle in
      `src/modules/catalog/application/commands/manage-book-deletion.ts` and the Catalog SQLite stores.
- [x] T013 [US1] Wire Catalog deletion state, Publishing cleanup and the shared immediate transaction
      in `src/composition/server.ts`, `src/composition/worker.ts` and
      `src/modules/catalog/adapters/filesystem/permanent-book-cleanup.ts`.
- [x] T014 [US1] Remove deletion-table reads, writes and deletion-specific retry branches from
      `src/modules/publishing/adapters/sqlite/jobs.ts`, then pass the focused deletion and recovery
      suites.

**Checkpoint**: Catalog no longer reproduces Publishing relationship SQL, Publishing jobs no longer
touch deletion tombstones, and all deletion/task joint transitions are atomic.

---

## Phase 4: User Story 2 - Explicit Maintenance Task Behavior (Priority: P1)

**Goal**: Reclamation and permanent deletion remain distinguishable in status, progress,
cancellation and retry without secondary lookups.

**Independent Test**: Queue, run, cancel and retry each maintenance identity through existing
contract/integration/E2E coverage and observe unchanged external status values.

### Implementation and Evidence for User Story 2

- [x] T015 [US2] Restrict generic retry and lease recovery to task-row mechanics and explicit kind
      dispatch in `src/modules/publishing/adapters/sqlite/jobs.ts`,
      `src/modules/publishing/application/recover-expired-jobs.ts` and
      `src/modules/publishing/application/retry-policy.ts`.
- [x] T016 [US2] Update existing maintenance task coverage for the direct identity mapping and
      bounded phase sets in `tests/integration/recovery/retention.test.ts`,
      `tests/integration/recovery/retry-policy.test.ts`,
      `tests/integration/recovery/worker-leases.test.ts` and `tests/e2e/worker-recovery.spec.ts`.
- [x] T017 [US2] Verify management task authorization, `private, no-store` behavior and unchanged
      public status values with `tests/contract/jobs.contract.test.ts` and the focused worker E2E flow.

**Checkpoint**: Status serialization performs no deletion lookup and generic task handling contains
no subject lifecycle policy.

---

## Phase 5: User Story 3 - One Writer Per Business Responsibility (Priority: P1)

**Goal**: Candidate lifecycle and version presentation writes each have one owner, while candidate
registration remains atomic.

**Independent Test**: Build, register, reconcile and recover candidates using existing publication
tests; presentation data and task/candidate terminal states remain consistent at crash boundaries.

### Implementation and Evidence for User Story 3

- [x] T018 [US3] Move candidate terminalization and candidate retry identity creation from
      `src/modules/publishing/adapters/sqlite/jobs.ts` into
      `src/modules/publishing/adapters/sqlite/draft-candidate-repository.ts` and the candidate application
      commands under `src/modules/publishing/application/commands/`.
- [x] T019 [US3] Expose the existing presentation insert as a narrow Catalog application writer in
      `src/modules/catalog/application/book-version-presentation.ts` and keep
      `src/modules/catalog/adapters/sqlite/book-presentations.ts` as its sole SQLite implementation.
- [x] T020 [US3] Inject the Catalog presentation writer into candidate registration and remove the
      duplicate insert from `src/modules/publishing/adapters/sqlite/versions.ts` and
      `src/modules/publishing/adapters/sqlite/candidate-registration.ts`.
- [x] T021 [US3] Route presentation reconciliation/recovery through the same writer in
      `src/modules/publishing/adapters/filesystem/storage-reconciliation.ts` and
      `src/composition/storage-reconciliation.ts`.
- [x] T022 [US3] Pass existing candidate crash-boundary, publication, search and presentation
      evidence in `tests/integration/publication/candidate-builder.test.ts`,
      `tests/integration/publication/book-presentations.test.ts` and
      `tests/integration/recovery/book-presentations.test.ts` without adding private-shape tests.

**Checkpoint**: `JobRepository` owns only generic task mechanics and one Catalog adapter writes
`book_version_presentations`.

---

## Phase 6: User Story 4 - Remove Confirmed Repository Residue (Priority: P2)

**Goal**: Production and local work surfaces contain no confirmed dead files, test-only compatibility
or reproducible stale output, while protected inputs remain untouched.

**Independent Test**: Standard checks and builds pass from the clean baseline; protected ignored and
untracked files remain present and unchanged.

### Implementation for User Story 4

- [x] T023 [P] [US4] Delete the unreferenced production files
      `src/modules/publishing/adapters/sqlite/audit-events.ts` and
      `src/platform/sqlite/capabilities.ts`.
- [x] T024 [US4] Make directly evidenced internal-only symbols private and remove obsolete forwarding
      exports in `src/modules/publishing/`, `src/modules/catalog/` and their `application/public.ts`
      surfaces, retaining framework exports and used runtime reset hooks.
- [ ] T025 [US4] Run formatting, lint, typecheck, complete automated tests, production build and the
      existing architecture checks; record commands and results in
      `specs/009-repository-debt-cleanup/evidence.md`.
- [ ] T026 [US4] Run the existing fifteen-book reference-v2 comparator and three representative
      B-only production builds, then record opaque fixture IDs, exactness and stage-duration comparison
      in `specs/009-repository-debt-cleanup/evidence.md`.
- [ ] T027 [US4] Remove only ignored reproducible `.cache/`, `test-results/` and generated build/report
      outputs listed in `specs/009-repository-debt-cleanup/research.md`, then verify protected `.env`,
      private fixtures and the three pre-existing untracked `docs/research/` files remain untouched.

**Checkpoint**: Current behavior and performance are unchanged and only evidence-backed residue is
gone.

---

## Phase 7: Convergence

**Purpose**: Synchronize implementation evidence and close the feature without adding another gate.

- [ ] T028 Update `specs/009-repository-debt-cleanup/tasks.md`,
      `specs/009-repository-debt-cleanup/quickstart.md`, relevant runtime architecture documentation and
      `docs/decisions/decision-log.md` to match the implemented ownership model.
- [ ] T029 Run Spec Kit converge, resolve every unmitigated CRITICAL finding in
      `specs/009-repository-debt-cleanup/`, and leave only the protected pre-existing untracked research
      documents in `git status --short`.

---

## Dependencies & Execution Order

- **Phase 1 -> Phase 2**: Preserve the baseline before the clean switch.
- **Phase 2 -> US1/US2/US3**: The task model and production test schema are shared prerequisites.
- **US1 -> US2**: Deletion-specific retry moves to its owner before generic retry is finalized.
- **US1 -> US3**: The shared transaction and cleanup boundary establish the composition pattern used
  by candidate/presentation registration.
- **US1 + US2 + US3 -> US4**: Dead exports and artifacts are removed only after their former consumers
  have been replaced and behavior evidence passes.
- **US4 -> Convergence**: Final documents record the verified implementation, not an intermediate
  design.

## Parallel Opportunities

- T023 can run independently after the source refactors stop touching its two confirmed dead files.
- Focused test commands for deletion/recovery and candidate/presentation can run concurrently only
  after their respective implementation batch is complete; source edits in shared SQLite and
  composition files should remain sequential.
- No cross-story parallel source work is recommended because the stories deliberately converge on
  `jobs.ts`, the baseline and shared transactions.

## Implementation Strategy

1. Complete T001-T007 and commit the real-schema/task-identity clean switch.
2. Complete US1 as the correctness MVP and commit only after atomic deletion evidence passes.
3. Complete US2 and US3 in that order, keeping each focused test set green.
4. Remove confirmed residue only after source ownership has converged.
5. Run the full and representative performance evidence once, clean reproducible output, converge
   the feature and commit the final documentation.

## Format Validation

- All 29 tasks use the required checkbox and sequential `Tnnn` identifier.
- Every user-story task carries exactly one `[USn]` label.
- `[P]` appears only where file ownership is independent at that point in the sequence.
- Every implementation and evidence task names an exact file or bounded directory.
