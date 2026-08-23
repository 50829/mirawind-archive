# Worker Observability Contract

## Private Health Representation

The existing authenticated `GET /api/manage/health` response remains private, no-store and
non-indexable. Its `worker` member accepts only a strict worker health schema of at most 64 KiB.

Required worker fields:

- schema version and observation timestamp;
- checkpoint, WAL and lease health;
- queue `{ queued_count, running_count, oldest_queued_age_ms }`;
- `current_attempt` or `null`;
- `recent_attempt` or `null`.

Attempt fields are limited to opaque task ID, task kind, attempt number, state, timestamps, duration,
nullable process-tree RSS peak, sampling availability, bounded stage observations and safe error
classification. Unknown fields, invalid numbers and more than the closed stage bound are rejected.

## Sampling And Emission

- Queue state is read after recovery, claim and completion and on the bounded idle checkpoint cycle.
- Phase duration uses a monotonic clock; wall timestamps are presentation metadata only.
- Process-tree RSS sampling runs no more often than every 250 ms and never overlaps.
- Process disappearance, permissions or malformed `/proc` data produce `null`/`unavailable`.
- Non-Linux environments report process-tree RSS as unavailable without spawning another inspection
  command; Linux remains the production evidence platform.
- State-change writes are coalesced for one second, active refreshes occur at most every five seconds,
  idle refreshes occur at most every 60 seconds and identical snapshots are skipped.
- The worker health reporter is the sole writer of the snapshot file.
- Sampling, serialization and atomic-write failures mark observation health unavailable, never fail
  the task, and are retried on the next bounded refresh.
- Queue query failure reports queue status unavailable and never substitutes empty counts.

## Clean Switch

- Schema v2 is the only accepted worker health representation.
- The former unversioned file, unknown newer versions, unknown fields, oversize files and malformed
  values are returned as unavailable without partial field reuse.
- Worker startup reconstructs and atomically replaces the derived snapshot; no migration is retained.

## Sensitive Data Exclusions

The snapshot and its logs must not contain:

- credentials, cookies or session values;
- Markdown, rendered body or content excerpts;
- original upload names;
- filesystem or archive paths;
- import evidence or diagnostics containing private content.
