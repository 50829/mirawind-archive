# Research: Permanent Book Deletion

## Decision 1: Deletion is an irreversible barrier plus asynchronous purge

**Decision**: Commit visibility loss and cleanup intent synchronously; perform physical
removal in the worker.

**Rationale**: Book trees may be multi-gigabyte and cannot be safely or predictably removed
inside a Web request. A durable barrier makes the product outcome immediate while retaining
enough state to finish cleanup after interruption.

**Alternatives considered**:

- Delete everything in the request: rejected because timeout or process loss can expose
  partially deleted state.
- Delayed soft delete: rejected because this release explicitly has no recycle bin or
  recovery window.
- Hide in UI only: rejected because readers, resources, search and worker finalizers would
  remain capable of exposure.

## Decision 2: Reuse scoped `reclaim` jobs

**Decision**: A `reclaim` job with no `book_id` remains global maintenance; one with a
`book_id` is permanent deletion cleanup.

**Rationale**: The current job kind constraint was created in migration 1. Adding another
kind would require a jobs-table rebuild across cyclic foreign keys for no behavioral
benefit. Reclaim already means durable background storage removal and already uses the
worker timeout, lease, cancellation and retry machinery.

**Alternatives considered**:

- New `delete_book` job kind: clearer label, but disproportionate migration and
  compatibility risk.
- An in-memory task: rejected because it cannot survive Web or worker restarts.
- A second queue/process: prohibited by the architecture and unnecessary.

## Decision 3: Dedicated content-free tombstone

**Decision**: Add `book_deletions`, keyed by an opaque deletion ID and retaining an opaque
book ID without a foreign key to the ordinary book row.

**Rationale**: The final purge must remove the ordinary book record and all content while
still supporting idempotency, crash recovery and bounded operational evidence. The table's
columns structurally prevent retaining titles, aliases, paths or body content.

**Alternatives considered**:

- Keep a deleted `books` row: rejected because the ordinary schema retains content-bearing
  columns and pointers and would become an accidental recovery source.
- Audit event only: rejected because audit retention and foreign keys are not a lifecycle
  state machine and existing audit metadata is more permissive.
- No evidence: rejected because retry and idempotent completion need a durable identity.

## Decision 4: Exact title after NFC plus strong state token

**Decision**: The dialog requires the displayed title. The server compares exact code-point
content after NFC normalization and separately validates an opaque mutation token derived
from current mutable book state.

**Rationale**: NFC treats canonically equivalent text as the same while preserving
punctuation, whitespace and case. The token prevents an old dialog from deleting a book
whose title, alias or version/draft state changed.

**Alternatives considered**:

- Client-side confirmation only: rejected because requests can bypass the UI.
- Case/whitespace-insensitive matching: rejected because it weakens deliberate
  confirmation for short or similar titles.
- Numeric ID entry: rejected because an opaque ID is not the administrator's mental model
  of the target.

## Decision 5: Existing session, origin protection, no recent reauthentication

**Decision**: Require the current authenticated administrator and existing mutation-origin
protections; do not apply the five-minute recent-auth window.

**Rationale**: This is the explicit product decision for the single-user deployment.
Exact-title confirmation, strong precondition and idempotency provide deliberate-action and
race protection without changing session semantics.

**Alternatives considered**:

- Password confirmation or recent-auth check: deferred because it conflicts with the
  approved requirement.
- CSRF token stored in public markup: unnecessary because the existing same-origin
  authenticated mutation pattern is reused.

## Decision 6: File-first, database-last cleanup

**Decision**: Remove every registered and deterministic filesystem target before the final
database content purge.

**Rationale**: Database state is the only durable inventory available after a crash. If the
database were deleted first, retained uploads or book trees could become untraceable
orphans. Missing paths are idempotent success, so retries naturally continue.

**Alternatives considered**:

- Database-first: rejected because it loses cleanup coordinates.
- Per-file database commits: rejected because it increases partial state and expands the
  recovery state machine.
- Rename to trash: rejected because that creates an implicit recovery store contrary to
  the feature.

## Decision 7: Cancellation plus finalizer barriers

**Decision**: Cancel/request-cancel related jobs at acceptance and add a deletion predicate
to every book-scoped finalizer and recovery path.

**Rationale**: Cancellation alone has a transaction-boundary race. A child may finish just
before observing cancellation. Compare-and-set finalization makes deletion win regardless
of completion timing.

**Alternatives considered**:

- Wait for every task before accepting deletion: rejected because it delays irreversible
  visibility and can block indefinitely.
- Kill only the running process: rejected because queued/retried work and already-written
  outputs remain.

## Decision 8: Deleted resources are non-cacheable missing resources

**Decision**: All routes resolve active/deletion state before conditional-cache processing
and use the existing private-resource-safe missing behavior.

**Rationale**: Returning `304 Not Modified` from an old ETag after deletion would authorize
reuse of a stale representation. A uniform missing response also prevents existence or
former-title disclosure.

**Alternatives considered**:

- `410 Gone`: rejected because it confirms prior existence and diverges from private
  resource behavior.
- Redirect: rejected because there is no recovery or replacement destination.

## Decision 9: Alias release occurs in the acceptance transaction

**Decision**: Set the active book alias to null when the barrier is installed.

**Rationale**: The product requires immediate reuse, and all old book-ID and alias routes
are already guarded by the barrier. A new book may safely claim the old alias without
reviving the old opaque book ID.

**Alternatives considered**:

- Hold alias until cleanup: rejected because large cleanup can take minutes and visibility
  has already ended.

## Decision 10: Safe storage deletion refuses symlink roots and broad targets

**Decision**: Derive targets from opaque IDs, resolve and compare them against explicit
configured roots, refuse a root itself, inspect target roots with `lstat`, and never follow a
symlink target.

**Rationale**: Cleanup is destructive. Exact server-derived targets and containment checks
prevent traversal, configuration mistakes and symlink escapes. Missing targets remain
idempotently complete.

**Alternatives considered**:

- Trust stored relative paths: rejected because imports are hostile and stored paths may be
  stale or corrupt.
- Recursive glob cleanup: rejected because a broad or unresolved glob can remove unrelated
  data.
