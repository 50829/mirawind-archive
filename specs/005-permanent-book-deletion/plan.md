# Implementation Plan: Permanent Book Deletion

**Branch**: `[005-permanent-book-deletion]` | **Date**: 2026-07-26 | **Spec**:
[spec.md](./spec.md)

**Input**: Feature specification from
`/specs/005-permanent-book-deletion/spec.md`

## Summary

Add irreversible, single-book deletion to the authenticated library. A successful request
atomically installs a deletion barrier, releases the alias, cancels related work and creates
one durable cleanup task. The request returns without deleting files. The existing worker
then removes exact filesystem targets before one final database purge, leaving one
content-free tombstone and a scrubbed task result. No recycle bin or restore path is
introduced.

The implementation reuses the existing `reclaim` job kind for a book-scoped cleanup job.
A global reclaim job continues to perform ordinary version/quarantine maintenance; a
reclaim job with a `book_id` performs permanent deletion. This avoids rebuilding the
existing constrained jobs table or adding another process, queue or database.

## Technical Context

**Language/Version**: TypeScript 6.0 on Node.js 24

**Primary Dependencies**: Astro 5, React 19, better-sqlite3, Zod, Tailwind CSS 4

**Storage**: SQLite WAL schema 7 plus local persistent storage beneath the configured data
root

**Testing**: Vitest unit/integration tests, Playwright browser tests, repository build and
type checks

**Target Platform**: One Linux host with one Astro Web process and one same-codebase worker

**Project Type**: Server-rendered Web application with private React management
enhancements and a durable local worker

**Performance Goals**: deletion acceptance under 1 second; public library/detail/reading
requests at or below the existing 300 ms uncached p95 target during cleanup

**Constraints**: irreversible after acceptance; no request-path file deletion; one worker
job globally; filesystem containment; no content in logs/tombstone/task output; immutable
published versions before deletion; exact-title confirmation; existing authenticated
administrator session without recent-reauth enforcement

**Scale/Scope**: single administrator, single-book operations, representative multi-GB
books, all book/import/source/version/config/job relationships and all public/private book
surfaces

## Constitution Check

*GATE result before Phase 0: PASS. Re-check after Phase 1: PASS.*

- **Authority & schemas**: Markdown plus versioned `book.yaml` remain authoritative until
  deletion. Schema 7 adds an irreversible barrier and a strict content-free tombstone table.
  Migration 7 is forward-only; migrations 1–6 remain unchanged. The migration manifest,
  fixtures and compatibility tests are updated.
- **Atomicity & recovery**: `BEGIN IMMEDIATE` accepts deletion by inserting the tombstone,
  setting the barrier, releasing the alias, canceling related queued work/requesting running
  cancellation, and creating one cleanup job. Cleanup removes files first and commits all
  ordinary content-record deletion only after required paths are absent. Every earlier
  failure remains retryable and hidden.
- **Security boundary**: the endpoint requires the existing administrator session,
  same-origin mutation protection, an idempotency key, a strong mutation token and NFC-exact
  current-title confirmation. Book lookup and authorization precede validator handling.
  Deleted subjects use non-cacheable missing-resource behavior on every public and private
  route. Cleanup targets are derived server-side and contained beneath the data root.
- **Request-path budget**: the request performs bounded SQLite work only. Cancellation,
  traversal, filesystem removal and database purge run in the existing worker. No parsing,
  rendering, image work or indexing moves into reader requests.
- **Evidence**: tests cover schema upgrade/repeat/FK behavior, request authorization and
  concurrency, idempotency, route/cache/search exclusion, all relationship-based job
  cancellation, finalizer races, symlink/traversal/root refusal, missing/partial files,
  crash boundaries, retries, recovery/reconciliation, representative multi-GB cleanup
  metadata and reading latency.
- **Simplicity**: no new service, process, queue, database, public route renderer or storage
  system is added. Existing repositories, job leases, child process timeout/cancellation,
  task UI, filesystem helpers and private React enhancement are extended.

## Design

### Schema and lifecycle

Schema 7 adds nullable `books.deletion_requested_at` as the active deletion barrier and a
strict `book_deletions` table. The tombstone contains only opaque book/deletion/actor/job
identities, timestamps, a bounded state and a bounded safe error code. It deliberately has
no foreign key to `books`, so it survives the final purge and cannot act as a restore
source.

The barrier has these states:

1. No tombstone and no barrier: ordinary active book.
2. Tombstone `pending|purging|failed` and barrier set: irreversibly hidden, content may
   remain only for cleanup retry.
3. Tombstone `completed`, ordinary book row absent: content removed and only bounded
   operational evidence remains.

There is no transition from state 2 or 3 back to state 1.

### Request transaction

`DELETE /api/manage/books/:bookId` performs, in order:

1. authenticate the administrator and require same-origin mutation headers;
2. require and validate an `Idempotency-Key`;
3. load the active private book, compare its mutation token, and NFC-normalize and compare
   the submitted confirmation title;
4. in one immediate transaction, insert the tombstone, set the barrier, null the alias,
   create a book-scoped reclaim job, cancel related queued jobs, request cancellation of
   related running jobs and write a bounded audit event;
5. return `202 Accepted` with stable deletion/task identifiers and task URL.

An accepted duplicate returns the same operation. A reused key with different input, stale
token, changed title, already-deleting book without the original identity, or unauthorized
request creates no state.

### Visibility and race closure

All active-book repository reads add `deletion_requested_at IS NULL`. Central public and
management resolvers therefore return the existing non-cacheable missing-resource response
before evaluating `If-None-Match` or `If-Modified-Since`. Search and libraries exclude the
barrier. Mutation and worker finalizers use the same predicate in their compare-and-set
updates, so publication, preview, configuration, retry, recovery and reconciliation cannot
make a deleting subject current or visible.

Related work is identified through direct `book_id` references plus associated imports,
source snapshots, configurations and versions. Queued work becomes canceled in the
acceptance transaction. Running work gets `cancel_requested_at`; the single-worker lease and
existing cooperative/forced termination policy ensure the deletion cleanup job cannot run
concurrently with an older child process.

### Cleanup order

A scoped reclaim handler derives these exact targets:

- `books/<opaque-book-id>`;
- retained `tmp/uploads/<opaque-import-id>` directories for every associated import;
- inactive staging directories owned by associated jobs.

Targets are resolved beneath configured roots, must not equal a storage root, and are
checked with `lstat`. Missing targets are complete. A symlink at a target or any containment
failure produces a bounded safe failure; traversal never follows links outside the target
tree.

After all targets are absent, one immediate transaction:

- revalidates the tombstone, barrier and cleanup-job ownership;
- deletes FTS/search rows, presentations, previews, versions, originals, configs, sources,
  import candidates/imports and the ordinary book row in foreign-key-safe order;
- detaches and scrubs the surviving cleanup job so it contains no book content;
- deletes or detaches other operational records that would retain book-linked content;
- marks the tombstone `completed` with a completion time.

The job parent then marks the scrubbed cleanup job succeeded. A crash before the database
transaction retries from durable barrier state; a crash after commit finds the completed
tombstone and succeeds idempotently.

### Administration UI

The private library API returns a strong mutation token and deletion capability for each
active entry. The React enhancement adds a keyboard-operable destructive dialog with the
current displayed title, irreversible/no-recycle-bin warning, exact-title input and explicit
final action. Acceptance removes the entry locally and links to the existing task-status
experience. Public HTML remains byte-identical and gains no management controls.

## Project Structure

### Documentation (this feature)

```text
specs/005-permanent-book-deletion/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── book-deletion-api.md
│   └── cleanup-protocol.md
├── checklists/
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── components/admin/AdministratorLibrary.tsx
├── db/
│   ├── migrations/007_permanent_book_deletion.sql
│   ├── migration-manifest.ts
│   └── repositories/
├── domain/ids.ts
├── lib/
│   ├── http/
│   └── storage/
├── pages/api/manage/
│   ├── library.ts
│   └── books/[bookId].ts
├── services/
│   ├── book-deletion.ts
│   └── permanent-book-cleanup.ts
└── worker/
    └── job-child.ts

tests/
├── contract/
├── integration/
├── unit/
└── browser/
```

**Structure Decision**: extend the existing same-codebase Web/worker layout. Domain logic
belongs in services and repositories; the API is a thin authenticated adapter; cleanup is
dispatched by the existing worker child; UI remains in the existing administrator
enhancement.

## Complexity Tracking

No constitution violations or new architectural components require an exception.
