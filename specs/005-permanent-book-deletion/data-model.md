# Data Model: Permanent Book Deletion

## Schema version

Schema version advances from 6 to 7 through a new immutable forward migration.

## `books` extension

| Field | Type | Null | Meaning |
|---|---|---:|---|
| `deletion_requested_at` | INTEGER | yes | Unix milliseconds at which the irreversible barrier committed |

Rules:

- `NULL` means the book may participate in ordinary behavior.
- Non-null means the book is permanently hidden and may only participate in cleanup.
- No code path clears a non-null value.
- Active-book indexes and queries include `deletion_requested_at IS NULL`.
- The alias is set to null in the same transaction that sets the barrier.

## `book_deletions`

Strict table containing the sole durable tombstone.

| Field | Type | Null | Constraint / meaning |
|---|---|---:|---|
| `id` | TEXT | no | primary key, opaque `del_*` ID |
| `book_id` | TEXT | no | unique opaque former book ID; deliberately no FK |
| `requested_by_user_id` | TEXT | no | opaque actor ID; deliberately no FK |
| `cleanup_job_id` | TEXT | no | unique opaque worker job ID; deliberately no FK |
| `idempotency_key_hash` | TEXT | no | unique keyed/hash representation, never raw client input |
| `request_fingerprint` | TEXT | no | bounded digest of book/token intent, no title |
| `state` | TEXT | no | `pending`, `purging`, `failed`, or `completed` |
| `safe_error_code` | TEXT | yes | allowlisted bounded machine code; never raw exception text |
| `requested_at` | INTEGER | no | Unix milliseconds |
| `started_at` | INTEGER | yes | first worker start |
| `completed_at` | INTEGER | yes | terminal purge commit time |
| `updated_at` | INTEGER | no | Unix milliseconds |

Checks:

- IDs and hashes are non-empty and bounded.
- `state` is limited to the four values.
- `safe_error_code` is null or bounded to 64 characters.
- `started_at >= requested_at` when present.
- `completed_at >= requested_at` when present.
- `state = 'completed'` iff `completed_at` is present.
- No title, alias, author, description, filename, path, body, diagnostic or arbitrary JSON
  column exists.

## Operational job representation

The existing `jobs` row is:

- `kind = 'reclaim'`;
- `book_id = target book` until the final database purge;
- ordinary queued/running/failed lifecycle and lease fields;
- progress phase limited to safe labels and numeric counts;
- detached from book/import/source/version/config references during final purge;
- retained long enough for the existing task UI and idempotent response, with content-free
  result/error data.

A reclaim job with `book_id IS NULL` and no associated deletion remains the existing global
maintenance job.

## Request state token

The management library returns an opaque token computed from:

- opaque book ID;
- current `updated_at`;
- current title digest;
- alias;
- current draft/config/source/version pointers;
- absence of a deletion barrier.

The token is not stored as a content-bearing field. The deletion request fingerprint stores
only a digest over the token, book ID and normalized title digest.

## Relationship closure

Related work and cleanup inventory include:

- `jobs.book_id = book`;
- `imports.book_id = book`;
- source snapshots owned by the book or created from an associated import;
- config revisions owned by the book;
- versions owned by the book;
- jobs referencing any associated import, source, config or version;
- job staging directories for that closed set;
- retained upload directories for associated imports;
- the deterministic opaque book directory.

## State transitions

```text
active
  └─ accepted transaction ─> pending (barrier set, alias released)
                               └─ worker lease ─> purging
                                      ├─ safe failure/timeout ─> failed
                                      │                           └─ retry ─> purging
                                      └─ file absence + DB commit ─> completed
```

Forbidden transitions:

- pending/purging/failed/completed → active;
- completed → retry;
- any deletion state → restore, republish or alias reassignment on the old row.

## Final purge order

Within one immediate transaction after filesystem absence:

1. validate barrier, tombstone and cleanup job;
2. remove search/FTS and presentation rows;
3. remove previews and derived draft rows;
4. detach/scrub operational rows that must outlive the book;
5. remove versions and version-dependent records;
6. remove originals, configs and sources;
7. remove import candidates and imports;
8. clear cyclic/current pointers and remove the ordinary book;
9. mark the tombstone completed.

Foreign keys are enabled and checked before commit. Any failure rolls the whole database
purge back while the deletion barrier remains visible to cleanup only.

## Migration and compatibility evidence

- fresh schema creation reaches version 7;
- an exact version-6 fixture upgrades without changing active book behavior;
- preexisting active books receive a null barrier;
- migration repeat/open is a no-op;
- foreign key check is empty after migration and after complete purge;
- schema-6 application compatibility is not claimed after migration; same-codebase Web and
  worker must deploy together on the single host;
- backup/restore continues to use the existing database and filesystem procedure, but
  restoring a pre-deletion backup is an operator disaster-recovery action, not a product
  recovery feature.
