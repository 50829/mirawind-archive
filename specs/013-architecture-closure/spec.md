# Feature Specification: Architecture Closure

**Feature Branch**: `main`

**Created**: 2026-08-23

**Status**: Approved

**Input**: Refactor the existing code to reduce coupling, split orchestration that owns too many
responsibilities, narrow cross-module application boundaries, preserve bounded worker execution,
and add queue, process-memory and stage-duration observations without changing product behavior.

## User Scenarios & Testing

### User Story 1 - Change one business module through a declared boundary (Priority: P1)

As a maintainer, I can change Publishing, Catalog, Reader or Identity behavior without importing
another module's internal storage, lifecycle or framework implementation.

**Why this priority**: Hidden cross-module knowledge makes otherwise local changes risky and causes
unrelated modules to move together.

**Independent Test**: Audit and exercise every cross-module command path, then verify that each path
uses one declared application operation and that the dependency graph contains no internal bypass,
reverse dependency or cycle.

**Acceptance Scenarios**:

1. **Given** a use case needs behavior owned by another module, **When** the dependency is inspected,
   **Then** it targets only the owning module's declared application surface.
2. **Given** a cross-module operation changes several records atomically, **When** any participant
   fails, **Then** all participating state remains at the previous consistent boundary.
3. **Given** an internal adapter or storage representation changes, **When** architecture checks and
   focused behavior tests run, **Then** consumers outside the owning module require no internal import.

---

### User Story 2 - Understand orchestration without reading one oversized module (Priority: P1)

As a maintainer, I can locate task acquisition, execution, terminal transitions, recovery and
operational reporting in focused components with explicit inputs and outcomes.

**Why this priority**: A single orchestration module that owns all lifecycle phases is difficult to
review, test and change safely even when its imports obey the dependency graph.

**Independent Test**: Trace one successful, failed, canceled, timed-out and interrupted task from
claim to terminal state and verify that each lifecycle responsibility has one owner and no behavior
is duplicated across orchestration components.

**Acceptance Scenarios**:

1. **Given** a queued task, **When** it is claimed and dispatched, **Then** acquisition and command
   execution can be tested independently from terminal-state recording.
2. **Given** a task fails, is canceled, times out or loses its lease, **When** recovery runs, **Then**
   exactly one owner decides and records the terminal transition and cleanup outcome.
3. **Given** a new task kind is added later, **When** its integration points are reviewed, **Then** the
   required acquisition, execution, terminal and observation responsibilities are explicit without
   adding another parallel orchestration path.

---

### User Story 3 - Observe queue health and expensive task stages (Priority: P1)

As the operator, I can determine whether work is waiting, which stage is expensive and how much
memory a task consumed without reading private book content or unsafe paths.

**Why this priority**: Existing progress helps identify the current step but does not provide a
complete production view of queue delay, per-stage elapsed time or peak process-tree memory.

**Independent Test**: Run representative successful and failed tasks, overlap queued work, and verify
that bounded observations expose queue depth, oldest queued age, stage durations, task duration and
peak process-tree memory while containing only safe identifiers and aggregate values.

**Acceptance Scenarios**:

1. **Given** no work, one running task and additional queued tasks, **When** operational state is
   observed, **Then** queued and running counts plus oldest queued age reflect each transition.
2. **Given** a task crosses several stages, **When** it succeeds or fails, **Then** every entered stage
   has one non-negative duration and the task has one peak process-tree memory value.
3. **Given** a task is canceled, times out, is interrupted or exits unexpectedly, **When** the terminal
   observation is recorded, **Then** completed-stage durations and the observed peak remain available
   with the safe terminal classification.
4. **Given** a private book or hostile archive path, **When** observations and logs are inspected,
   **Then** they contain no credentials, cookies, complete content, original filenames or raw paths.

---

### User Story 4 - Preserve bounded and recoverable execution (Priority: P1)

As a reader and operator, I continue to receive the current published version while background work
runs within established concurrency, timeout, cancellation and recovery limits.

**Why this priority**: A structural refactor or new monitoring must not weaken the isolation that
protects reader latency and publication correctness.

**Independent Test**: Execute representative and stress builds with overlapping reader/search
traffic, cancellation, timeout and interruption injection, then compare behavior and resource limits
with the accepted baseline.

**Acceptance Scenarios**:

1. **Given** several queued jobs, **When** the worker runs, **Then** no more than one job executes and
   no more than four pages are rendered concurrently.
2. **Given** a build is canceled or exceeds its deadline, **When** the termination grace expires,
   **Then** the complete task process tree exits and the previous published version remains current.
3. **Given** observations are enabled during a representative build, **When** performance is compared
   with the accepted baseline, **Then** reading, search, build time and memory stay within the existing
   regression tolerances.

### Edge Cases

- The worker is idle, loses its database connection, or is shutting down while queue state changes.
- A child exits between its final stage update and its result message.
- A stage is entered more than once because an attempt retries; observations must remain attempt-scoped.
- A contiguous repeated phase update extends one stage; leaving and later re-entering an earlier
  phase in the same attempt is rejected as a phase-order violation. A retry is a separate attempt.
- RSS sampling races with rapid child or descendant process exit.
- The process tree temporarily cannot be sampled; task execution must continue and the missing sample
  must be distinguishable from a measured zero.
- A stage reports malformed, decreasing or out-of-range progress.
- A lease expires immediately before terminal state is committed.
- Queue observation must not cause an unbounded log stream while the state remains unchanged.

## Requirements

### Functional Requirements

- **FR-001**: Every cross-module command dependency MUST target a declared, narrow application
  operation owned by the providing module.
- **FR-002**: Modules MUST NOT import another module's internal core, adapter, storage representation
  or framework integration.
- **FR-003**: Cross-module operations that require one atomic state change MUST preserve one explicit
  transaction boundary without duplicating another module's relationship or lifecycle queries.
- **FR-004**: Task acquisition, frozen-input capture, child execution, terminal-state transition,
  retry/recovery coordination and operational reporting MUST each have one identifiable owner.
- **FR-005**: Orchestration components MUST communicate through explicit bounded inputs and outcomes;
  they MUST NOT introduce a second task dispatch, completion or recovery path.
- **FR-006**: Operational observations MUST expose queued count, running count and oldest queued age
  at task-state changes and at a bounded refresh interval.
- **FR-007**: Each task attempt MUST expose total elapsed time, durations for every entered stage and
  peak observed memory for the worker child process tree.
- **FR-008**: Missing or failed process-memory samples MUST be represented as unavailable rather than
  as zero and MUST NOT fail or cancel the task.
- **FR-008a**: Queue observation, process sampling, serialization or health-file write failure MUST
  NOT change task, lease, terminal or published-version state; the affected representation MUST
  become unavailable rather than fabricate counts or measurements and retry on a later bounded refresh.
- **FR-009**: Queue, stage and memory observations MUST use opaque task identities, bounded numeric
  values and safe classifications only; they MUST NOT contain credentials, sessions, full private
  content, original upload names or raw filesystem/archive paths.
- **FR-010**: Existing progress semantics MUST reject malformed or decreasing updates and remain
  consistent with the corresponding stage duration.
- **FR-011**: The worker MUST continue to execute at most one job globally, render at most four pages
  concurrently, enforce the 30-minute task deadline and use the existing 10-second termination grace.
- **FR-012**: Failed, canceled, timed-out, interrupted and orphaned work MUST retain existing terminal,
  cleanup, retry and immutable-publication behavior.
- **FR-013**: Reader requests MUST continue to serve immutable generated artifacts and MUST NOT gain
  parsing, rendering, indexing, queue inspection or process observation work.
- **FR-014**: Public and management HTTP behavior, authentication, authorization, cache, indexing and
  hidden-private-resource behavior MUST remain unchanged.
- **FR-015**: The refactor MUST preserve the existing authoritative source, schema identities,
  database baseline, worker protocol and published-version format unless a separately approved
  decision and transition is created before implementation.
- **FR-016**: New abstractions MUST remove a current duplicated responsibility, oversized ownership
  set or cross-module dependency; speculative generic managers and unused extension points are
  prohibited.

### Non-Functional Requirements

- **NFR-001**: The active dependency graph MUST contain zero forbidden imports, reverse dependencies,
  cycles or cross-module internal bypasses.
- **NFR-002**: Queue and process observations MUST remain bounded in cardinality and emission rate and
  MUST add no external telemetry service or new persistence authority.
- **NFR-003**: Representative background work with observations enabled MUST not regress per-book wall
  time by more than `max(5%, 1 s)` or peak process-tree memory by more than `max(5%, 64 MiB)`.
- **NFR-004**: Public reading p95 MUST remain at most 300 ms and search p95 at most 1,000 ms during the
  established overlapping-request workload.
- **NFR-005**: Representative content output MUST remain exact, and publication crash-boundary,
  cancellation, interruption, timeout and retry evidence MUST remain successful.
- **NFR-006**: Deployment MUST remain one Linux host, one Web process, one same-codebase worker, one
  local database and private local persistent storage.

### Key Entities

- **Module Application Boundary**: The declared operations and data needed by another business
  module without exposing internal policy or storage.
- **Task Attempt**: One immutable execution attempt with an opaque identity, kind, captured input,
  lease, progress and terminal outcome.
- **Queue Observation**: A bounded snapshot of queued/running counts and oldest queued age.
- **Stage Observation**: Attempt-scoped elapsed time and progress for one entered execution stage.
- **Process-Tree Memory Observation**: The best available peak resident-memory measurement for the
  isolated task child and its descendants.
- **Orchestration Responsibility**: One lifecycle concern with explicit inputs, outcome and owner.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Architecture validation reports zero forbidden dependency edges, cycles, canonical
  import violations or cross-module internal imports across all product source.
- **SC-002**: Every audited cross-module command path has exactly one declared application operation
  and zero duplicated command-side relationship or lifecycle queries outside the owning module.
- **SC-003**: Successful, failed, canceled, timed-out and interrupted task scenarios each produce one
  terminal transition and one cleanup/recovery outcome with no duplicate execution path.
- **SC-004**: Queue observations correctly report all tested empty, queued, running and draining states,
  including oldest queued age, without unbounded repeated output for unchanged state.
- **SC-005**: One hundred percent of entered stages in representative successful and failed attempts
  have a valid duration; every attempt reports a peak memory value or an explicit unavailable state.
- **SC-006**: Logs and observations from hostile and private fixtures contain zero credentials,
  original filenames, raw paths or complete content excerpts.
- **SC-007**: The representative and stress workload preserves one running job, at most four in-flight
  rendered pages, the task timeout and termination grace under normal, cancellation and timeout paths.
- **SC-008**: Reference comparison remains exact, public reading and search targets pass, and no
  representative build exceeds the accepted wall-time or memory regression tolerance.
- **SC-009**: Standard format, architecture, lint, type, automated test and production build gates all
  pass after the refactor.

## Assumptions

- Current D-117 module ownership and candidate-build architecture remain authoritative; this feature
  closes remaining implementation coupling rather than selecting a new topology.
- Existing structured logging and in-process metric surfaces are the observation destinations; no
  external collector or administrator dashboard is required.
- Queue and memory observations are operational derived data and do not require a new schema or
  portable compatibility format.
- Existing task kinds, response contracts and user-visible progress labels remain unchanged.
- File splitting follows responsibility and change boundaries, not a line-count threshold.

## Out of Scope

- Redis, external queues, PostgreSQL, object storage, multiple workers, multiple Web instances or
  microservices.
- New administrator dashboards, alert delivery, long-term metrics retention or third-party telemetry.
- New task kinds, new publishing stages, product features or behavior changes.
- Database, `book.yaml`, manifest, version-marker or worker-protocol migrations.
- Rewriting stable pure compiler algorithms solely to produce smaller files.
