# Data Model: Architecture Closure

This feature adds no authoritative or persistent database entity. The following values are bounded,
derived operational or application-boundary models.

## Catalog Presentation Source

A Catalog-owned input derived by Publishing from validated immutable version artifacts.

- `bookId`: positive stable book ID
- `versionId`: opaque version ID
- `configRevision`: positive revision
- `createdAtMs`: safe non-negative timestamp
- `alias`, `title`, bounded metadata fields and optional cover resource ID
- first-page identity and at most 200 bounded TOC preview entries

Validation constructs the existing projection schema v2 and digest. It never contains Markdown,
filesystem paths, source IDs, compiler identities or version lifecycle state.

## Queue Observation

- `observedAt`: UTC timestamp
- `queuedCount`: non-negative safe integer
- `runningCount`: `0 | 1`
- `oldestQueuedAgeMs`: non-negative safe integer or `null`

Computed from task state. It is not persisted in SQLite and is safe to overwrite.

## Stage Observation

- `phase`: safe phase enum for the task kind
- `startedAt`: UTC timestamp
- `durationMs`: non-negative monotonic elapsed time
- `progress`: last accepted bounded progress
- `status`: `running | completed | failed | canceled | interrupted | timeout`

A phase is appended once per contiguous entry. Repeated progress for the same phase updates that
entry; a new phase closes the previous duration. Returning to an earlier phase in the same attempt is
invalid. Retried jobs are separate attempts.

## Attempt Observation

- `jobId`: opaque task ID
- `kind`: closed task kind
- `attempt`: positive attempt number
- `state`: `running` or safe terminal state
- `startedAt`, optional `finishedAt`, and `durationMs`
- `peakProcessTreeRssBytes`: non-negative safe integer or `null`
- `memorySampling`: `available | unavailable`
- bounded ordered stage observations, never exceeding the closed phase count for the task kind
- optional safe `errorClass` and `errorCode`

The current attempt becomes the recent attempt after completion. At most one current and one recent
attempt are retained in the health snapshot.

## Worker Health Snapshot

An overwrite-only JSON value of at most 64 KiB in the private temporary directory.

- `schemaVersion`: `2`
- `checkedAt`: UTC timestamp
- `status`: `healthy | warning`
- latest WAL checkpoint and lease health
- latest queue observation
- current attempt or `null`
- most recent terminal attempt or `null`
- bounded safe warning codes

The file is not an authority, can be deleted, and is reconstructed by the worker. The transition from
the former unversioned shape is an approved clean switch: unknown versions, old unversioned files and
malformed/oversized files are treated as unavailable by the Web health route, then overwritten by a
fresh v2 snapshot after worker startup. No old field is migrated or guessed.

## State Transitions

```text
queue: empty -> queued -> running -> draining/empty

attempt: running
  -> succeeded | failed | canceled | interrupted

stage: running
  -> completed when next phase begins
  -> succeeded | failed | canceled | interrupted | timeout when attempt ends
```

Timeout remains a task failure classification while the stored task state follows the existing job
contract. Observations do not create or change task lifecycle state.
