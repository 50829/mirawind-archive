# Data Model: Repository Debt Cleanup

## Authority and Transition

Publishing authorities remain normalized Markdown and `book.yaml` v3. Manifest v2, version marker
v2, presentation, search rows and published HTML remain rebuildable derived data. Jobs and deletion
records are server-only lifecycle state.

This feature uses an owner-approved clean switch of the single SQLite baseline and worker protocol.
No stored content format changes. Existing test-stage databases are reinitialized; an incompatible
ledger is rejected before mutation by the existing baseline mechanism.

## Job

The existing row remains an immutable attempt. Its relevant cleaned fields are:

| Field                          | Rule                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `id`                           | opaque `job_*` primary key                                                   |
| `kind`                         | closed operation identity including `reclaim_versions` and `purge_book`      |
| `book_id`                      | null only while genuinely bookless; authoritative scope once a book is known |
| `import_id`                    | optional operation input, not a fallback source of book ownership            |
| `candidate_id`                 | present only for candidate build attempts                                    |
| `version_id`                   | present only where the operation requires a version                          |
| `retry_of_job_id`              | immutable predecessor attempt                                                |
| lease/progress/terminal fields | unchanged bounded semantics                                                  |

### Internal and external identity

| Internal kind      | Management API kind       | Subject                             |
| ------------------ | ------------------------- | ----------------------------------- |
| `reclaim_versions` | `reclaim`                 | global retained versions/quarantine |
| `purge_book`       | `permanent_book_deletion` | one deleting book until final purge |

The mapping is total and pure. Status serialization never inspects another table.

### State transitions

Task row transitions remain:

```text
queued -> running -> succeeded | failed | canceled | interrupted
queued -> canceled
terminal -> new immutable retry attempt
```

Subject lifecycle changes participate in the same transaction as a relevant terminal or retry
transition.

## Book Scope Assignment

An uploaded import and its initial `analyze_import` job may have `book_id = null`. The transaction that
associates the import with a new or selected book MUST set `book_id` on every job for that import that
has no conflicting scope. All later prepare/candidate/version/deletion jobs are created with the book
scope directly.

After assignment, cancellation, retry, cleanup inventory and purge use only `jobs.book_id` to select
work for the book. Source/version pointers remain operation captures, not ownership fallbacks.

## Draft Candidate

The persistent shape and states remain unchanged. Lifecycle ownership changes:

- candidate repository/use case creates a new candidate identity with a build retry;
- candidate terminal state changes in the same transaction as its task terminal state;
- generic task persistence never reads or updates `draft_candidates`;
- stale candidate and current revision checks remain unchanged.

## Book Deletion

The tombstone fields and public states remain `pending`, `purging`, `failed`, `completed`. It retains
`book_id`, current `cleanup_job_id`, safe error and timestamps after the ordinary book row is gone.

### Atomic transitions

```text
active book
  -> accept transaction: pending + purge_book queued + visibility barrier
pending
  -> worker lease: purging
pending/purging
  -> terminal transaction: failed + purge_book failed/canceled/interrupted
failed
  -> retry transaction: pending + new purge_book attempt
pending/purging
  -> filesystem absence + final transaction: completed + book data removed
completed
  -> parent completion: retained purge_book task succeeded
```

The completed tombstone is idempotent. Completed deletion cannot retry. A failure transaction must
not leave `pending` or `purging` behind.

## Publishing Cleanup Boundary

The Catalog deletion application consumes a narrow boundary with three current operations:

1. cancel queued and request cancellation of running Publishing work for one `book_id`, excluding
   the cleanup task;
2. capture bounded opaque import/job IDs needed to remove exact upload/staging paths;
3. scrub and purge Publishing-owned rows for one `book_id` during the final transaction, retaining
   the designated cleanup task row.

The boundary contains no database object, SQL fragment, raw path, title or content. Catalog owns the
book barrier/tombstone; Publishing owns its records. Composition supplies the shared immediate
transaction and concrete adapters.

## Version Presentation

The existing `BookVersionPresentation` fields and schema version remain unchanged. The Catalog
application surface adds one writer operation:

```text
insert(BookVersionPresentation) -> BookVersionPresentation
```

Exactly one SQLite implementation exists. Candidate registration calls it inside the existing outer
registration transaction; reconciliation and recovery call the same repository. Duplicate identity
or projection mismatch behavior remains unchanged.

## Deletion Closure

Final deletion preserves the current product result while assigning SQL ownership:

- Catalog store: book pointer clearing/removal, Catalog-owned presentation rows, tombstone update;
- Publishing cleanup adapter: task scrubbing, candidate/version/source/config/import/original/search
  removal;
- filesystem adapter: exact opaque book, upload and staging targets;
- retained records: deletion tombstone and the cleanup task result with content-free fields.

Read-only Catalog/Reader joins are unchanged.
