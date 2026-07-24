CREATE TABLE job_idempotency_keys (
  operation TEXT NOT NULL CHECK (length(operation) BETWEEN 1 AND 100),
  key_sha256 TEXT NOT NULL CHECK (length(key_sha256) = 64),
  job_id TEXT NOT NULL REFERENCES jobs (id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (operation, key_sha256)
) STRICT, WITHOUT ROWID;

CREATE INDEX job_idempotency_job ON job_idempotency_keys (job_id);
