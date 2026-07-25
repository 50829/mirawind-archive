ALTER TABLE books
ADD COLUMN deletion_requested_at INTEGER
CHECK (deletion_requested_at IS NULL OR deletion_requested_at >= 0);

CREATE INDEX books_active_visibility_current
ON books(visibility, current_version_id)
WHERE deletion_requested_at IS NULL;

CREATE TABLE book_deletions (
  id TEXT PRIMARY KEY CHECK (
    id GLOB 'del_*' AND length(id) BETWEEN 20 AND 84
  ),
  book_id INTEGER NOT NULL UNIQUE CHECK (book_id >= 1),
  requested_by_user_id TEXT NOT NULL CHECK (
    length(requested_by_user_id) BETWEEN 1 AND 200
  ),
  cleanup_job_id TEXT NOT NULL UNIQUE CHECK (
    cleanup_job_id GLOB 'job_*' AND length(cleanup_job_id) BETWEEN 20 AND 84
  ),
  idempotency_key_hash TEXT NOT NULL UNIQUE CHECK (
    length(idempotency_key_hash) = 64
  ),
  request_fingerprint TEXT NOT NULL CHECK (
    length(request_fingerprint) = 64
  ),
  state TEXT NOT NULL CHECK (
    state IN ('pending', 'purging', 'failed', 'completed')
  ),
  safe_error_code TEXT CHECK (
    safe_error_code IS NULL OR (
      length(safe_error_code) BETWEEN 3 AND 64
      AND safe_error_code NOT GLOB '*[^A-Z0-9_]*'
    )
  ),
  requested_at INTEGER NOT NULL CHECK (requested_at >= 0),
  started_at INTEGER CHECK (
    started_at IS NULL OR started_at >= requested_at
  ),
  completed_at INTEGER CHECK (
    completed_at IS NULL OR completed_at >= requested_at
  ),
  updated_at INTEGER NOT NULL CHECK (updated_at >= requested_at),
  CHECK (
    (state = 'completed' AND completed_at IS NOT NULL)
    OR (state != 'completed' AND completed_at IS NULL)
  )
) STRICT;

CREATE INDEX book_deletions_state_updated
ON book_deletions(state, updated_at);
