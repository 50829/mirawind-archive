# Feature Specification: Permanent Book Deletion

**Feature Branch**: `[005-permanent-book-deletion]`

**Created**: 2026-07-26

**Status**: Delivered

**Input**: Add irreversible single-book deletion without a recycle bin. Keep only a
content-free minimal audit tombstone. Require the administrator to type the current book
title, automatically cancel related work, and do not require recent reauthentication.

## User Scenarios & Testing

### User Story 1 - Deliberately delete one book forever (Priority: P1)

As the sole administrator, I can select one book in the library, review an explicit
irreversible warning, type the book's current displayed title, and permanently delete it
without first visiting a separate storage or recycle-bin page.

**Why this priority**: The administrator needs a direct way to remove books and reclaim
storage while avoiding an accidental one-click destructive action.

**Independent Test**: Open the authenticated library, choose one draft, private or public
book, enter its exact displayed title, confirm deletion, and observe that the book
immediately disappears from every ordinary book surface while a cleanup task is reported.

**Acceptance Scenarios**:

1. **Given** an active book and an authenticated administrator, **When** the administrator
   chooses delete, **Then** a clearly named dialog identifies the book, states that the
   operation cannot be undone, and requires the current displayed title before enabling the
   final action.
2. **Given** the exact current title and an unchanged book, **When** the administrator
   confirms, **Then** deletion is accepted once, the alias is released, and the book
   immediately disappears from public and administrator library, details, reading, search,
   resource and download surfaces.
3. **Given** a mismatched title, stale book state, cross-site request, missing session or
   non-administrator session, **When** deletion is attempted, **Then** no deletion state or
   cleanup work is created and the response reveals no private book content.
4. **Given** the same accepted request is submitted again with the same idempotency
   identity, **When** the server receives it, **Then** it returns the same deletion outcome
   without creating a second cleanup operation.

---

### User Story 2 - Deletion wins over background work (Priority: P2)

As the administrator, I can delete a book even while its import, preview, rebuild,
verification or publication work is queued or running, and no stale task can make the book
reappear.

**Why this priority**: A destructive lifecycle transition is unsafe if a concurrent worker
can publish or restore the target after deletion was accepted.

**Independent Test**: Start each supported book-scoped task, request deletion before the
task finishes, and verify that queued work is canceled, running work terminates within the
existing worker policy, and all later finalization or retry attempts are rejected.

**Acceptance Scenarios**:

1. **Given** queued work for the book, **When** deletion is accepted, **Then** that work is
   canceled before cleanup and cannot be retried against the deleted subject.
2. **Given** running work for the book, **When** deletion is accepted, **Then** termination
   is requested immediately, the existing bounded termination policy is enforced, and
   cleanup begins only after the process has stopped.
3. **Given** publication and deletion race at a transaction boundary, **When** either
   transaction commits first, **Then** the observable result after deletion acceptance is
   always a hidden book that cannot become current again.
4. **Given** a cached public representation or an old conditional request, **When** the
   book enters deletion, **Then** every new server request receives a non-cacheable hidden
   response rather than an old success or not-modified response.

---

### User Story 3 - Finish cleanup without a recovery path (Priority: P3)

As the administrator, I can see whether permanent cleanup is queued, running, completed or
failed, and a failed cleanup can be retried without restoring the deleted book.

**Why this priority**: Multi-gigabyte books span database and filesystem state, so deletion
must survive crashes and partial cleanup without leaving visible data or requiring manual
database repair.

**Independent Test**: Inject interruption and filesystem failures before and after each
cleanup boundary, restart the worker, retry as needed, and verify that the book remains
hidden, all content is eventually removed, and only the approved minimal tombstone remains.

**Acceptance Scenarios**:

1. **Given** deletion has been accepted, **When** cleanup removes only part of the data or
   the process stops, **Then** the book stays hidden and a retry continues from the durable
   deletion state without restoring content.
2. **Given** all registered and deterministic storage has been removed, **When** database
   cleanup commits, **Then** source, configuration, preview, version, presentation, search,
   original, import and ordinary book records are removed together.
3. **Given** cleanup completes, **When** the administrator inspects the task result, **Then**
   it reports completion without exposing removed titles, filenames, paths or private body
   content.
4. **Given** cleanup has completed, **When** any recovery, reconciliation, retry or route
   resolver runs later, **Then** it cannot reconstruct, republish or expose the deleted
   book; only a non-restorable minimal audit tombstone remains.

### Edge Cases

- The current title contains Unicode, punctuation, leading or repeated internal whitespace,
  or differs only by Unicode normalization.
- The title or alias changes between opening the confirmation dialog and submitting it.
- The administrator double-clicks, refreshes after acceptance or resubmits from two tabs.
- The book has never been published, has no ready preview, or has a corrupt/missing current
  version.
- The book has current, ready, failed, corrupt, superseded and reclaimed version records.
- An import associated with the book still has a retained upload outside the book directory.
- A task has no direct book identifier but refers to an import or version belonging to the
  book.
- A worker finishes file generation immediately before or after deletion state commits.
- One storage path is already missing, permission-denied, a symbolic link or outside the
  configured data root.
- The Web or worker stops after the book is hidden, after some files are removed, or after
  files are removed but before database cleanup commits.
- The old alias is reused by a new book while an old client still holds a URL or ETag.
- Cleanup of a representative multi-gigabyte book reaches the existing task timeout.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST allow only the sole authenticated administrator to request
  permanent deletion of one active book at a time from the library management enhancement.
- **FR-002**: The confirmation surface MUST identify the current displayed title, state
  that deletion is permanent and has no recycle bin or recovery path, and require the
  administrator to enter that title before submission.
- **FR-003**: Title confirmation MUST compare the submitted title with the current
  administrator-visible title after Unicode NFC normalization and MUST reject a title or
  book state that changed after the confirmation surface was opened.
- **FR-004**: Permanent deletion MUST use the existing valid administrator session and
  same-origin mutation protection and MUST NOT require the session to be within the recent
  five-minute authentication window.
- **FR-005**: A deletion request MUST have a strong concurrency precondition and an
  idempotency identity; stale requests create no state, and repeated accepted requests
  return one stable deletion outcome.
- **FR-006**: Accepting deletion MUST atomically place the book behind an irreversible
  deletion barrier, release its alias, record a bounded audit event and create durable
  cleanup work.
- **FR-007**: Once the deletion barrier commits, the book MUST be absent from public and
  administrator libraries, details, reading, search, assets, original downloads, previews
  and book-management mutations.
- **FR-008**: Hidden or deleted book responses MUST be non-cacheable; authorization and
  deletion state MUST be evaluated before conditional request handling so an old validator
  cannot produce a successful or not-modified response.
- **FR-009**: Accepting deletion MUST cancel all queued jobs belonging to the book and
  request cancellation of all running jobs belonging through a book, import, source,
  configuration or version relationship.
- **FR-010**: A book-scoped task finalizer, publication transaction, retry or recovery
  action MUST reject a subject whose deletion barrier has committed.
- **FR-011**: Permanent cleanup MUST run outside the Web request in the existing durable
  worker model, use the existing cooperative and forced termination policy, and expose
  bounded task status.
- **FR-012**: Cleanup MUST remove the complete deterministic book directory, all associated
  retained upload directories and all inactive staging directories belonging to the book.
- **FR-013**: Cleanup MUST remove all book content records, including search rows,
  presentations, versions, previews, configurations, sources, originals, import candidates,
  imports and the ordinary active book record.
- **FR-014**: Filesystem cleanup MUST resolve exact targets beneath the configured data root,
  treat missing targets as already complete, refuse broad/root targets, and never follow a
  symbolic link outside the target tree.
- **FR-015**: Database content removal MUST occur only after all required filesystem targets
  are absent; a crash before database removal MUST leave enough durable state to retry.
- **FR-016**: A partial failure or interruption MUST leave the deletion barrier in force,
  record only a bounded safe status, and permit idempotent cleanup retry without any restore
  action.
- **FR-017**: Completed cleanup MUST retain only a minimal non-restorable tombstone
  containing opaque deletion and book identities, request and completion times, actor and
  cleanup task identities, terminal state and a bounded safe error code.
- **FR-018**: The tombstone and deletion task output MUST NOT retain the book title, alias,
  description, authors, body, original filenames, source paths, storage paths, archive
  diagnostics or credentials.
- **FR-019**: Reconciliation and recovery MUST recognize deleting and deleted subjects,
  MUST NOT quarantine their expected removals as unexplained corruption, and MUST never
  publish or restore them.
- **FR-020**: A completed deletion MUST make the previous alias immediately reusable while
  all obsolete numeric and alias routes follow the existing non-cacheable missing-resource
  behavior.
- **FR-021**: The administrator library enhancement MUST show an accessible destructive
  confirmation flow and MUST direct accepted operations to the existing task-status
  experience without adding deletion controls to cacheable public HTML.
- **FR-022**: This feature MUST support single-book deletion only and MUST NOT expose
  recycle-bin, restore, delayed-retention or batch-deletion behavior.

### Non-Functional Requirements

- **NFR-001**: Every deletion page, API, task and hidden response class MUST declare
  authentication, authorization, cache and indexing behavior.
- **NFR-002**: The request that accepts deletion MUST complete the irreversible visibility
  transition and return a task outcome within one second on the reference single-host
  deployment without waiting for book files to be removed.
- **NFR-003**: Cleanup MUST remain within the existing 30-minute job limit; exceeding the
  limit leaves the subject hidden and produces a safe retryable cleanup failure.
- **NFR-004**: Schema evolution MUST use a forward migration with old-database upgrade,
  data-preservation, repeat-run, foreign-key and compatibility evidence; existing migration
  files MUST remain unchanged.
- **NFR-005**: Crash-boundary evidence MUST cover deletion acceptance, job termination,
  partial filesystem cleanup, filesystem-complete/database-pending and database commit.
- **NFR-006**: Public library, details and reading requests MUST retain the approved
  300-millisecond uncached p95 target while deletion cleanup runs.
- **NFR-007**: Logs, audit rows, task progress and errors MUST remain bounded and MUST NOT
  contain credentials, complete private content, book titles, original filenames or storage
  paths for a deleting or deleted book.
- **NFR-008**: The confirmation flow MUST be keyboard operable, have a programmatic name,
  visible focus, an explicit irreversible warning and no serious or critical automated
  accessibility finding at desktop and 360-pixel mobile widths.

### Key Entities

- **Deletion Barrier**: The irreversible active-book state that immediately excludes the
  subject from reads, writes, search, publication, recovery and ordinary administration.
- **Permanent Deletion Request**: One idempotent administrator intent bound to an exact
  book state and title confirmation and associated with one cleanup task.
- **Cleanup Task**: Durable background work that cancels competing work, removes exact
  filesystem targets and then removes all ordinary database content.
- **Deletion Tombstone**: Minimal, content-free and non-restorable evidence that deletion
  was requested and whether cleanup completed.

## Success Criteria

### Measurable Outcomes

- **SC-001**: An authenticated administrator can deliberately request deletion of one book
  in at most three actions plus title entry, and the accepted book disappears from every
  ordinary book surface within one second.
- **SC-002**: The complete anonymous and administrator route/search matrix exposes zero
  successful or not-modified responses for a book after its deletion barrier commits.
- **SC-003**: All queued and running job-race fixtures finish with zero deleted books
  republished, restored or made current.
- **SC-004**: Every injected crash and cleanup-failure boundary keeps the book hidden and
  reaches complete cleanup after a bounded retry without manual database edits.
- **SC-005**: Complete cleanup leaves zero book content, derived search, source, original,
  preview, version, retained upload or staging records/files and exactly one approved
  minimal tombstone.
- **SC-006**: Migration, authorization, cache, cancellation, publication-race, filesystem
  containment, recovery and accessibility evidence all pass with no unmitigated critical
  finding.
- **SC-007**: Public library, details and representative reading responses remain at or
  below 300 milliseconds p95 while a representative deletion cleanup runs.

## Assumptions

- The product continues to use one sole administrator and the existing authenticated
  private library enhancement.
- Exact title confirmation is sufficient accidental-deletion protection for this single
  user deployment; recent reauthentication is intentionally not required.
- Cleanup is operationally asynchronous but deletion is irreversible as soon as accepted;
  no supported action can cancel deletion or restore remaining bytes.
- A content-free opaque audit tombstone is permitted to outlive the deleted book.
- Existing worker cancellation, timeout and bounded retry behavior is reused.
- Previously delivered client copies cannot be recalled, but every new server request is
  denied after deletion acceptance.

## Out of Scope

- Recycle bin, restore, undo, grace period or delayed automatic deletion
- Multi-select and batch deletion
- Deleting a single attachment while retaining the Web book
- Secure media erasure guarantees beyond normal filesystem deletion
- Product backup, backup deletion or removal of copies outside the application data root
