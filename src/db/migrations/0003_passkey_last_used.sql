CREATE TABLE passkey_usage (
  passkey_id TEXT PRIMARY KEY REFERENCES passkey (id) ON DELETE CASCADE,
  last_used_at INTEGER NOT NULL
) STRICT;
