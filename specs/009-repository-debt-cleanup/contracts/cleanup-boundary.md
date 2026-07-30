# Contract: Catalog and Publishing Cleanup Boundary

## Ownership

Catalog owns the book deletion request, visibility barrier, book row and retained deletion tombstone.
Publishing owns publishing jobs, candidates, imports, source snapshots, configurations, originals,
versions and search data. The version presentation is a Catalog read model with one Catalog writer.

## Application operations

Catalog deletion orchestration may request only these Publishing operations:

### Cancel book work

Input: stable positive `bookId`, cleanup `jobId`, timestamp.

Effect inside the acceptance transaction:

- cancel queued Publishing tasks scoped to the book except the cleanup task;
- request cancellation for running tasks scoped to the book;
- terminalize a canceled building candidate consistently;
- return bounded counts only.

### Capture removal inventory

Input: stable positive `bookId`.

Output: sorted opaque import IDs and job IDs scoped to the book. No raw path, title, filename or body
may cross the boundary. Filesystem targets are derived later from validated IDs and configured roots.

### Purge Publishing records

Input: stable positive `bookId`, retained cleanup `jobId`, timestamp.

Effect inside the final immediate transaction:

- remove Publishing-owned derived and authoritative server records for that book in foreign-key-safe
  order;
- detach/scrub retained operational rows and preserve the cleanup task;
- leave Catalog-owned book, tombstone and presentation changes to the Catalog store;
- return bounded counts only.

## Atomic coordination

Composition provides one immediate transaction runner to the Catalog application use case. Acceptance,
terminal failure/interruption, retry and final purge must invoke all participating stores inside that
single transaction. Adapters do not start a second independent transaction for a partial lifecycle
transition.

## Failure behavior

- Any acceptance failure leaves the active book and all tasks unchanged.
- Any task terminalization failure rolls back both job and tombstone state.
- Any final database purge failure rolls back all database changes while the visibility barrier and
  idempotently absent files remain; retry repeats absence checks and the transaction.
- No operation may publish, restore or expose a deleting book.
