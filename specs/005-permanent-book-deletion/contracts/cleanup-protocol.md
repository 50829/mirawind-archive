# Contract: Permanent Cleanup Protocol

## Dispatch

The existing worker dispatches `kind = reclaim`:

- `book_id IS NULL`: existing global version/quarantine reclaim behavior;
- `book_id IS NOT NULL`: permanent deletion cleanup for the matching tombstone.

The parent worker retains lease renewal, cancellation, timeout, child termination, retry
limits and terminal job recording.

## Preconditions

Before destructive work, the child must verify:

- a matching `book_deletions.cleanup_job_id`;
- `books.deletion_requested_at IS NOT NULL`, unless the tombstone is already completed;
- the leased cleanup job matches the tombstone and target book;
- no active non-cleanup job can still finalize against the book;
- configured data, uploads and staging roots resolve to explicit absolute roots.

A completed tombstone is idempotent success. Any inconsistent mapping is a bounded safe
failure and performs no broad cleanup.

## Safe progress vocabulary

Allowed phases:

- `waiting_for_cancellation`
- `enumerating_targets`
- `removing_book_storage`
- `removing_uploads`
- `removing_staging`
- `purging_database`
- `completed`

Progress may contain integer counts/bytes only. It must not include names or paths.

Allowed safe error families:

- `invalid_deletion_state`
- `target_outside_root`
- `unsafe_target`
- `filesystem_permission`
- `filesystem_io`
- `cleanup_timeout`
- `database_conflict`
- `database_integrity`
- `interrupted`

Raw exception messages are logged only after sanitization and are not persisted when they
could contain book content or paths.

## Filesystem rules

For each server-derived target:

1. build it from an opaque validated ID and the configured root;
2. resolve the parent/root and perform a path-segment containment comparison;
3. reject an empty target, the root itself, `.`/`..`, separator-bearing IDs or a target
   outside its root;
4. inspect the target root with `lstat`;
5. treat `ENOENT` as complete;
6. reject a symbolic-link target;
7. recursively remove without following directory symlinks;
8. verify absence before proceeding.

Removal is idempotent. No glob, user-provided path or archive entry is accepted as a target.

## Database commit

The final immediate transaction revalidates all preconditions, removes all ordinary
book-content records, detaches and scrubs required operational records, deletes the active
book row, and marks the tombstone completed. Foreign keys must remain valid.

If the transaction fails, no database content deletion is committed. Since files are
already absent, a retry repeats absence checks and retries the database transaction.

## Crash boundaries

| Boundary | Durable outcome | Restart behavior |
|---|---|---|
| before acceptance commit | active book or fully accepted deletion, never half state | normal request retry |
| after barrier/before job lease | hidden book + queued cleanup | worker leases job |
| during cancellation wait | hidden book + cancel intent | existing lease recovery/timeout |
| during file removal | hidden book + partial/missing targets | idempotent removal continues |
| files absent/DB pending | hidden book + complete inventory | repeat checks and purge |
| DB commit/parent success pending | completed tombstone + detached job | idempotent child success; parent records success |

Recovery and reconciliation ignore expected absence for pending/purging/failed/completed
deletions and never synthesize a book from leftover bytes.
