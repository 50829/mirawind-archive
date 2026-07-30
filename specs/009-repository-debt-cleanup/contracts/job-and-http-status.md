# Contract: Maintenance Jobs and Management Status

## Internal worker commands

The worker protocol keeps discriminated commands. The former `reclaim` command is removed.

### Reclaim versions

```json
{
  "kind": "reclaim_versions",
  "jobId": "job_opaque",
  "attempt": 1,
  "createdAtMs": 1785400000000,
  "stagingRelativePath": "staging/job_opaque"
}
```

It has no book field and runs only retained-version/quarantine maintenance.

### Purge book

```json
{
  "kind": "purge_book",
  "jobId": "job_opaque",
  "bookId": 42,
  "attempt": 1,
  "createdAtMs": 1785400000000,
  "stagingRelativePath": "staging/job_opaque"
}
```

It requires a positive stable book ID and a matching non-completed deletion tombstone. Commands do
not carry a deletion title, alias, raw path or content.

## Closed phases

- `reclaim_versions`: `queued`, `starting`, `reclaim_storage`, terminal phases.
- `purge_book`: `queued`, `starting`, `permanent_book_deletion`, terminal phases.

Existing bounded progress and parent/child message validation remain unchanged.

## Management status

The authenticated task endpoints retain their current response class, authorization,
`private, no-store` caching and no-index behavior.

Status values remain externally compatible:

- internal `reclaim_versions` serializes as `kind: "reclaim"`;
- internal `purge_book` serializes as `kind: "permanent_book_deletion"`.

Serialization is a pure function of the job row. It performs no database query and accepts no
optional database argument.

## Retry

- A generic non-subject task retry copies only its operation input into a new immutable attempt.
- A candidate retry atomically creates a new task and candidate identity and updates the current
  candidate pointer after existing staleness checks.
- A purge retry atomically creates a new `purge_book` attempt and updates the same failed tombstone's
  `cleanup_job_id` and state.
- Completed deletion, deleted subject, stale candidate and exhausted automatic retry behavior remain
  rejected with existing safe errors.
