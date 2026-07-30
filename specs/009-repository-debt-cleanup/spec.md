# Feature Specification: Repository Debt Cleanup

**Feature Branch**: `main`

**Created**: 2026-07-31

**Status**: Approved

**Input**: Remove confirmed technical debt, dead code, obsolete runtime paths and stale local
artifacts while preserving current publishing, deletion, recovery, reading and performance behavior.
Favor readable ownership boundaries and narrow extension points over additional compatibility logic,
speculative abstractions or redundant tests.

## User Scenarios & Testing

### User Story 1 - Delete a book without hidden lifecycle gaps (Priority: P1)

As the administrator, I can permanently delete a book and receive one coherent task outcome even if
the worker fails, is canceled, is interrupted or retries.

**Why this priority**: The current cleanup task and deletion record can reach different terminal
states, leaving a hidden recovery problem despite a completed task response.

**Independent Test**: Exercise successful deletion and the existing failure, cancellation,
interruption and retry flows, then verify that the book, task and deletion record always agree and
that unrelated books remain available.

**Acceptance Scenarios**:

1. **Given** an active book, **When** permanent deletion succeeds, **Then** all of that book's
   content is removed, its deletion record is complete and the cleanup task reports success.
2. **Given** cleanup fails or is interrupted, **When** the terminal result is recorded, **Then** the
   cleanup task and deletion record expose the same retryable failure outcome with no pending state.
3. **Given** a failed cleanup is retried, **When** the retry is accepted, **Then** one new attempt is
   associated with the same deletion and can complete it without reviving other work for the book.

---

### User Story 2 - Operate publishing jobs through clear task identities (Priority: P1)

As the administrator, I can distinguish routine storage reclamation from permanent book deletion in
the task list, progress display and retry behavior without hidden database-dependent relabeling.

**Why this priority**: One task identity currently represents two unrelated operations, which causes
branching throughout status, retry and worker code.

**Independent Test**: Queue one routine reclamation task and one permanent deletion task, observe
their complete lifecycles, and verify their progress, cancellation and retry behavior independently.

**Acceptance Scenarios**:

1. **Given** routine version reclamation is queued, **When** its status is read, **Then** it is always
   identified and processed as storage reclamation.
2. **Given** permanent deletion is queued, **When** its status is read, **Then** it is always
   identified and processed as book deletion without a secondary lookup.
3. **Given** either task is retried, **When** the new attempt is created, **Then** it retains only the
   identity and subject data required for that operation.

---

### User Story 3 - Change one module without editing another module's storage rules (Priority: P1)

As a maintainer, I can change Catalog deletion behavior, Publishing job behavior or presentation
storage through a declared boundary instead of reproducing another module's table knowledge.

**Why this priority**: Source imports currently look well layered while command-side database logic
still reaches across module ownership, so schema changes can break distant code silently.

**Independent Test**: Inspect and exercise book deletion, candidate registration and reconciliation;
each write responsibility has one owner and cross-module coordination uses explicit operations with
one transaction boundary.

**Acceptance Scenarios**:

1. **Given** a book is accepted for deletion, **When** related publishing work is canceled, **Then**
   Catalog requests that operation without reproducing Publishing's relationship queries.
2. **Given** a built candidate is registered or reconciled, **When** its display projection is
   written, **Then** one authoritative writer is used in every flow.
3. **Given** a cross-module operation fails before commit, **When** state is inspected, **Then** none
   of its participating records have partially advanced.

---

### User Story 4 - Keep the repository small and understandable (Priority: P2)

As a maintainer, I can navigate production code without unused files, test-only production branches,
unnecessary public exports or stale generated work directories.

**Why this priority**: Confirmed dead code and compatibility branches increase the apparent surface
area and make future work harder to place and review.

**Independent Test**: Build and validate the product from the current clean baseline after removing
confirmed unused paths and generated artifacts; existing behavior remains available without a second
compatibility implementation.

**Acceptance Scenarios**:

1. **Given** repository tests need a database, **When** they initialize it, **Then** they exercise the
   same complete baseline schema as production rather than requiring missing-table behavior.
2. **Given** a production symbol or file has no runtime, build, script or test consumer, **When** the
   cleanup is complete, **Then** it is removed or made private instead of retained speculatively.
3. **Given** ignored benchmark and test output can be regenerated, **When** local cleanup runs, **Then**
   it is removed while private fixtures, environment configuration and tracked evidence are preserved.

### Edge Cases

- A deletion cleanup loses its worker lease immediately before terminal state is recorded.
- A deletion retry is requested after the book has been hidden but before its files are removed.
- An import begins before it belongs to a book and is assigned to a book later.
- Candidate registration fails while the version, search data and presentation are being recorded.
- Reconciliation needs to rebuild a missing presentation after the writer has been consolidated.
- Local generated output exists beside ignored private MinerU or EPUB fixtures that must be retained.

## Requirements

### Functional Requirements

- **FR-001**: Routine version reclamation and permanent book deletion MUST have distinct task
  identities throughout creation, progress, status, execution, cancellation and retry.
- **FR-002**: Every task associated with a book MUST acquire one authoritative book scope when that
  association becomes known; later cancellation, deletion and retry MUST use that scope rather than
  infer it through other records.
- **FR-003**: Recording a permanent deletion task's failed, canceled or interrupted terminal outcome
  and recording the deletion's corresponding outcome MUST be one atomic state transition.
- **FR-004**: Successful permanent deletion MUST preserve its minimal deletion record and cleanup
  task outcome while removing the deleted book's content, derived data and unrelated historical work
  according to the existing product behavior.
- **FR-005**: Generic task storage MUST be limited to queueing, leasing, progress and task-row state;
  candidate and deletion lifecycle changes MUST remain owned by their respective business behavior.
- **FR-006**: Cross-module write coordination MUST use explicit, narrow operations with a single
  transaction boundary. A module MUST NOT reproduce another module's command-side relationship or
  lifecycle queries.
- **FR-007**: Candidate registration, recovery and reconciliation MUST use one authoritative writer
  for each version presentation.
- **FR-008**: Tests of task persistence and leases MUST use the complete active database baseline;
  production behavior MUST NOT probe for or adapt to tables omitted only by tests.
- **FR-009**: Confirmed unused production files, forwarding files and exports MUST be removed or made
  private. No replacement test may assert only that old code is absent.
- **FR-010**: Generated benchmark, build and test artifacts MAY be removed only when they are ignored,
  reproducible and not the sole retained evidence of an accepted result.
- **FR-011**: Private local fixtures, environment configuration, tracked audit reports, published
  version immutability and user-authored untracked work MUST remain untouched.
- **FR-012**: Current upload, preparation, candidate build, preview, publication, deletion, recovery,
  reading, authorization, cache and search behavior MUST remain functionally equivalent.
- **FR-013**: The cleanup MUST preserve canonical internal imports, one-way module dependencies and
  the existing application boundary for each business module.
- **FR-014**: New abstractions MUST correspond to a current cross-module operation or duplicated
  responsibility. The cleanup MUST NOT add unused future interfaces, generic managers or duplicate
  facades.
- **FR-015**: Boundaries naturally created by this cleanup SHOULD allow later metadata, visibility,
  attachment, folder and EPUB use cases to be added without reaching into Publishing internals, but
  this feature MUST NOT implement or expand those product capabilities.
- **FR-016**: The active database baseline and worker task protocol MUST switch directly to the
  cleaned model. Existing test-stage data MAY be reinitialized; no dual-read, dual-write or migration
  compatibility path may remain.

### Non-Functional Requirements

- **NFR-001**: Existing hostile-input, authorization, hidden-404, immutable publication, bounded
  worker, cancellation and recovery guarantees MUST remain unchanged.
- **NFR-002**: Cleanup evidence MUST be proportional to the changed behavior and reuse existing tests;
  it MUST NOT add absence-only, private-object-shape, obsolete-baseline or speculative edge-case tests.
- **NFR-003**: The standard formatting, dependency, type, automated test and production build checks
  MUST remain successful.
- **NFR-004**: Representative production book processing MUST remain reference-exact and must not
  regress by more than the greater of 5 percent or one second per selected book under the established
  measurement environment.
- **NFR-005**: Public reading and search request paths MUST not gain document processing, new storage
  lookups or additional cross-module command coordination.
- **NFR-006**: The system MUST remain one web process, one same-codebase worker, one local database and
  private local storage on one host.

### Key Entities

- **Background Task**: One immutable attempt with a single operation identity, optional book scope,
  lease, bounded progress and terminal outcome.
- **Book Deletion**: Minimal durable record of a requested permanent deletion and the cleanup task
  currently responsible for it.
- **Candidate Attempt**: Publishing-owned lifecycle for one draft revision and its immutable version.
- **Version Presentation**: Rebuildable bounded display projection for one immutable version with one
  write owner and multiple read consumers.
- **Book Scope**: The stable book identity attached to work once its subject book is known.
- **Cleanup Boundary**: Explicit coordination between Catalog-owned deletion state and
  Publishing-owned work/data removal.

## Success Criteria

### Measurable Outcomes

- **SC-001**: All existing deletion, recovery, candidate registration, publication, authorization,
  search and architecture behavior checks pass after the cleanup.
- **SC-002**: Every tested deletion success, failure, cancellation, interruption and retry ends with
  matching task and deletion states; zero deletion records remain unintentionally pending or purging.
- **SC-003**: Routine reclamation and permanent deletion are distinguishable directly from their task
  records in 100 percent of tested status and retry flows.
- **SC-004**: Command-side cross-module storage writes and duplicated presentation insert paths found
  by this feature's audit are reduced to zero; declared coordination operations remain the only
  cross-module mutation surface.
- **SC-005**: Production task handling contains zero table-existence probes or missing-table branches
  used solely to support tests.
- **SC-006**: The active source graph has zero dependency cycles, forbidden boundary imports or
  non-canonical product-source imports.
- **SC-007**: The fifteen-book reference comparison remains 15 of 15 exact, and three representative
  production book builds stay within the stated per-book performance tolerance.
- **SC-008**: All confirmed dead production files and exports in the accepted cleanup inventory are
  removed, and no replacement compatibility or forwarding layer is introduced.
- **SC-009**: Reproducible ignored cache and test output selected for cleanup is removed while every
  protected private fixture, environment file and pre-existing untracked research document remains.

## Assumptions

- Current test-stage database contents may be discarded because the baseline remains under active
  development; production must never erase or reinterpret an incompatible database automatically.
- Existing tracked audit reports are sufficient retained evidence after their ignored raw work
  directories are removed.
- Read-only joins used by Catalog and Reader to construct query projections are intentional and do
  not constitute command-side ownership leakage.
- Test reset hooks for unavoidable process-local runtime singletons remain unless the implementation
  replaces the singleton with a simpler real dependency boundary; test naming alone is not evidence
  that a hook is dead.
- Content-analysis rules are outside this cleanup because they are staged, reference-exact and on the
  established performance path.

## Out of Scope

- New metadata, visibility, attachment, folder, batch-management, reading-state or EPUB features.
- Changes to printed contents recognition, typography, preprocessing, document structure, pagination
  or semantic rendering algorithms.
- A new service, database, queue, deployment unit, package workspace or global state framework.
- Broad file splitting based only on line count, speculative ports, general-purpose service layers or
  tests that verify implementation absence rather than behavior.
- Re-running a historical baseline, AB/BA/AB benchmarking or long-running stability soak.
