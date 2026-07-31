CREATE TABLE database_baseline (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  identity TEXT NOT NULL UNIQUE
    CHECK (identity = 'mirawind-clean-slate-maintenance-v1')
) STRICT;

INSERT INTO database_baseline (id, identity)
VALUES (1, 'mirawind-clean-slate-maintenance-v1');

CREATE TABLE installation (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  admin_user_id TEXT UNIQUE,
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE books (
  id INTEGER PRIMARY KEY,
  alias TEXT UNIQUE CHECK (
    alias IS NULL OR (
      length(alias) BETWEEN 1 AND 120
      AND alias GLOB '[a-z0-9]*'
      AND alias NOT GLOB '*[^a-z0-9-]*'
      AND alias NOT GLOB '[0-9]*'
    )
  ),
  visibility TEXT NOT NULL CHECK (visibility IN ('draft', 'private', 'public')),
  title_cache TEXT NOT NULL CHECK (length(title_cache) BETWEEN 1 AND 500),
  draft_source_id TEXT,
  draft_config_revision INTEGER,
  current_candidate_id TEXT,
  current_version_id TEXT,
  unavailable_reason TEXT CHECK (
    unavailable_reason IS NULL OR length(unavailable_reason) <= 80
  ),
  deletion_requested_at INTEGER CHECK (
    deletion_requested_at IS NULL OR deletion_requested_at >= 0
  ),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (draft_config_revision IS NOT NULL OR current_candidate_id IS NULL),
  FOREIGN KEY (draft_source_id) REFERENCES source_snapshots(id),
  FOREIGN KEY (id, draft_config_revision)
    REFERENCES config_revisions(book_id, revision),
  FOREIGN KEY (current_candidate_id) REFERENCES draft_candidates(id),
  FOREIGN KEY (current_version_id) REFERENCES book_versions(id)
) STRICT;

CREATE TABLE imports (
  id TEXT PRIMARY KEY CHECK (id GLOB 'imp_*'),
  original_name TEXT NOT NULL CHECK (length(original_name) BETWEEN 1 AND 255),
  state TEXT NOT NULL CHECK (
    state IN (
      'uploaded',
      'analyzing',
      'needs_main_confirmation',
      'preparing',
      'draft_ready',
      'rejected',
      'canceled',
      'expired'
    )
  ),
  upload_rel_path TEXT NOT NULL,
  upload_size_bytes INTEGER NOT NULL CHECK (
    upload_size_bytes BETWEEN 0 AND 2147483648
  ),
  upload_sha256 TEXT NOT NULL CHECK (length(upload_sha256) = 64),
  selected_candidate_id TEXT,
  book_id INTEGER REFERENCES books(id),
  safe_error_code TEXT CHECK (
    safe_error_code IS NULL OR length(safe_error_code) <= 80
  ),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (id, selected_candidate_id)
    REFERENCES import_candidates(import_id, id)
) STRICT;

CREATE TABLE source_snapshots (
  id TEXT PRIMARY KEY CHECK (id GLOB 'src_*'),
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
  main_markdown_path TEXT NOT NULL,
  main_markdown_sha256 TEXT NOT NULL CHECK (length(main_markdown_sha256) = 64),
  source_root_rel_path TEXT NOT NULL,
  analysis_version TEXT NOT NULL CHECK (length(analysis_version) <= 100),
  created_from_import_id TEXT NOT NULL REFERENCES imports(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  UNIQUE (book_id, id)
) STRICT;

CREATE TABLE config_revisions (
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  source_id TEXT NOT NULL REFERENCES source_snapshots(id) ON DELETE RESTRICT,
  schema_version INTEGER NOT NULL CHECK (schema_version = 3),
  yaml_rel_path TEXT NOT NULL,
  yaml_sha256 TEXT NOT NULL CHECK (length(yaml_sha256) = 64),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (book_id, revision),
  UNIQUE (book_id, revision, source_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE jobs (
  id TEXT PRIMARY KEY CHECK (id GLOB 'job_*'),
  kind TEXT NOT NULL CHECK (
    kind IN (
      'analyze_import',
      'prepare_draft',
      'build_candidate',
      'verify_version',
      'reconcile',
      'reclaim_versions',
      'purge_book'
    )
  ),
  state TEXT NOT NULL CHECK (
    state IN ('queued', 'running', 'succeeded', 'failed', 'canceled', 'interrupted')
  ),
  import_id TEXT REFERENCES imports(id) ON DELETE RESTRICT,
  book_id INTEGER REFERENCES books(id) ON DELETE RESTRICT,
  candidate_id TEXT,
  version_id TEXT,
  captured_source_id TEXT REFERENCES source_snapshots(id) ON DELETE RESTRICT,
  captured_config_revision INTEGER,
  captured_current_version_id TEXT,
  retry_of_job_id TEXT REFERENCES jobs(id) ON DELETE RESTRICT,
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  automatic_retry_count INTEGER NOT NULL DEFAULT 0 CHECK (
    automatic_retry_count BETWEEN 0 AND 1
  ),
  lease_owner TEXT,
  lease_until INTEGER,
  heartbeat_at INTEGER,
  phase TEXT NOT NULL CHECK (length(phase) BETWEEN 1 AND 80),
  progress_json TEXT NOT NULL DEFAULT
    '{"completed":0,"total":null,"unit":"steps","processed_bytes":null}'
    CHECK (json_valid(progress_json) AND length(progress_json) <= 65536),
  error_code TEXT CHECK (error_code IS NULL OR length(error_code) <= 80),
  error_class TEXT CHECK (
    error_class IS NULL OR error_class IN (
      'infrastructure',
      'content',
      'validation',
      'security_limit',
      'timeout',
      'canceled'
    )
  ),
  error_detail_json TEXT CHECK (
    error_detail_json IS NULL OR (
      json_valid(error_detail_json) AND length(error_detail_json) <= 65536
    )
  ),
  cancellation_requested_at INTEGER,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  CHECK (
    (state = 'running' AND lease_owner IS NOT NULL AND lease_until IS NOT NULL)
    OR state != 'running'
  ),
  FOREIGN KEY (book_id, captured_config_revision)
    REFERENCES config_revisions(book_id, revision),
  FOREIGN KEY (candidate_id) REFERENCES draft_candidates(id),
  FOREIGN KEY (captured_current_version_id) REFERENCES book_versions(id)
) STRICT;

CREATE TABLE original_files (
  id TEXT PRIMARY KEY CHECK (id GLOB 'file_*'),
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
  source_id TEXT NOT NULL REFERENCES source_snapshots(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role = 'mineru_zip'),
  storage_rel_path TEXT NOT NULL,
  original_name TEXT NOT NULL CHECK (length(original_name) BETWEEN 1 AND 255),
  media_type TEXT NOT NULL CHECK (length(media_type) BETWEEN 3 AND 200),
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 0 AND 2147483648),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  created_at INTEGER NOT NULL,
  UNIQUE (book_id, source_id, role)
) STRICT;

CREATE TABLE import_candidates (
  id TEXT PRIMARY KEY CHECK (id GLOB 'cand_*'),
  import_id TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  normalized_path TEXT NOT NULL CHECK (length(normalized_path) BETWEEN 1 AND 2048),
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'generic', 'ambiguous')),
  score INTEGER NOT NULL,
  evidence_json TEXT NOT NULL CHECK (
    json_valid(evidence_json) AND length(evidence_json) <= 65536
  ),
  diagnostics_json TEXT NOT NULL CHECK (
    json_valid(diagnostics_json) AND length(diagnostics_json) <= 1048576
  ),
  UNIQUE (import_id, normalized_path),
  UNIQUE (import_id, id)
) STRICT;

CREATE TABLE book_versions (
  id TEXT PRIMARY KEY CHECK (id GLOB 'ver_*'),
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
  source_id TEXT NOT NULL REFERENCES source_snapshots(id) ON DELETE RESTRICT,
  config_revision INTEGER NOT NULL,
  predecessor_version_id TEXT REFERENCES book_versions(id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (
    state IN ('ready', 'published', 'superseded', 'discarded', 'corrupt')
  ),
  version_rel_path TEXT NOT NULL UNIQUE,
  manifest_schema_version INTEGER NOT NULL CHECK (manifest_schema_version = 2),
  manifest_sha256 TEXT NOT NULL CHECK (length(manifest_sha256) = 64),
  version_marker_sha256 TEXT NOT NULL CHECK (length(version_marker_sha256) = 64),
  semantic_digest TEXT NOT NULL CHECK (length(semantic_digest) = 64),
  compiler_version TEXT NOT NULL CHECK (length(compiler_version) <= 100),
  renderer_version TEXT NOT NULL CHECK (length(renderer_version) <= 100),
  preview_version TEXT NOT NULL CHECK (length(preview_version) <= 100),
  reader_version TEXT NOT NULL CHECK (length(reader_version) <= 100),
  blocking_diagnostic_count INTEGER NOT NULL CHECK (
    blocking_diagnostic_count BETWEEN 0 AND 10000
  ),
  complete_at INTEGER NOT NULL,
  published_at INTEGER,
  verified_at INTEGER,
  reclaimed_at INTEGER CHECK (reclaimed_at IS NULL OR reclaimed_at >= 0),
  created_by_job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  FOREIGN KEY (book_id, config_revision, source_id)
    REFERENCES config_revisions(book_id, revision, source_id),
  UNIQUE (book_id, id)
) STRICT;

CREATE TABLE draft_candidates (
  id TEXT PRIMARY KEY CHECK (id GLOB 'candidate_*'),
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
  source_id TEXT NOT NULL REFERENCES source_snapshots(id) ON DELETE RESTRICT,
  config_revision INTEGER NOT NULL,
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE RESTRICT,
  version_id TEXT UNIQUE REFERENCES book_versions(id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (
    state IN (
      'building',
      'ready',
      'failed',
      'canceled',
      'interrupted',
      'discarded'
    )
  ),
  semantic_digest TEXT CHECK (
    semantic_digest IS NULL OR length(semantic_digest) = 64
  ),
  safe_error_code TEXT CHECK (
    safe_error_code IS NULL OR (
      length(safe_error_code) BETWEEN 3 AND 80
      AND safe_error_code NOT GLOB '*[^A-Z0-9_]*'
    )
  ),
  blocking_diagnostic_count INTEGER CHECK (
    blocking_diagnostic_count IS NULL
    OR blocking_diagnostic_count BETWEEN 0 AND 10000
  ),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  completed_at INTEGER CHECK (
    completed_at IS NULL OR completed_at >= created_at
  ),
  CHECK (
    (state = 'ready'
      AND version_id IS NOT NULL
      AND semantic_digest IS NOT NULL
      AND blocking_diagnostic_count IS NOT NULL
      AND safe_error_code IS NULL
      AND completed_at IS NOT NULL)
    OR
    (state <> 'ready'
      AND version_id IS NULL
      AND semantic_digest IS NULL
      AND blocking_diagnostic_count IS NULL)
  ),
  CHECK (
    (state = 'building' AND safe_error_code IS NULL AND completed_at IS NULL)
    OR state <> 'building'
  ),
  FOREIGN KEY (book_id, config_revision, source_id)
    REFERENCES config_revisions(book_id, revision, source_id),
  UNIQUE (book_id, id)
) STRICT;

CREATE TABLE search_short_fields (
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES book_versions(id) ON DELETE CASCADE,
  page_id INTEGER NOT NULL CHECK (page_id >= 1),
  block_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('title', 'author', 'heading')),
  normalized_text TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  PRIMARY KEY (version_id, kind, ordinal)
) STRICT, WITHOUT ROWID;

CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY,
  actor_user_id TEXT,
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 100),
  book_id INTEGER REFERENCES books(id) ON DELETE RESTRICT,
  version_id TEXT REFERENCES book_versions(id) ON DELETE RESTRICT,
  job_id TEXT REFERENCES jobs(id) ON DELETE RESTRICT,
  safe_metadata_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(safe_metadata_json) AND length(safe_metadata_json) <= 65536),
  created_at INTEGER NOT NULL
) STRICT;

CREATE VIRTUAL TABLE search_fts USING fts5(
  title,
  authors,
  heading,
  body,
  book_id UNINDEXED,
  version_id UNINDEXED,
  page_id UNINDEXED,
  block_id UNINDEXED,
  kind UNINDEXED,
  ordinal UNINDEXED,
  tokenize = 'trigram',
  detail = full
);

CREATE UNIQUE INDEX one_published_version_per_book
  ON book_versions(book_id)
  WHERE state = 'published';
CREATE UNIQUE INDEX one_ready_version_per_book
  ON book_versions(book_id)
  WHERE state = 'ready';
CREATE INDEX draft_candidates_book_revision
  ON draft_candidates(book_id, config_revision, created_at);
CREATE INDEX source_snapshots_book ON source_snapshots(book_id, created_at);
CREATE INDEX config_revisions_source ON config_revisions(source_id);
CREATE INDEX imports_state_expiry ON imports(state, expires_at);
CREATE INDEX import_candidates_import_score
  ON import_candidates(import_id, score DESC, id);
CREATE INDEX book_versions_book_state
  ON book_versions(book_id, state, complete_at);
CREATE INDEX jobs_claim_order ON jobs(state, created_at, id);
CREATE INDEX jobs_lease_expiry ON jobs(state, lease_until);
CREATE INDEX jobs_scope ON jobs(book_id, import_id, created_at);
CREATE INDEX search_short_current
  ON search_short_fields(book_id, version_id, kind, normalized_text);
CREATE INDEX audit_events_scope
  ON audit_events(book_id, job_id, version_id, created_at);

-- Better Auth 1.6.25 and @better-auth/passkey 1.6.25 schema.
CREATE TABLE "user" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "emailVerified" INTEGER NOT NULL,
  "image" TEXT,
  "createdAt" DATE NOT NULL,
  "updatedAt" DATE NOT NULL
);

CREATE TABLE "session" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "expiresAt" DATE NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "createdAt" DATE NOT NULL,
  "updatedAt" DATE NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
);

CREATE TABLE "account" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" DATE,
  "refreshTokenExpiresAt" DATE,
  "scope" TEXT,
  "password" TEXT,
  "createdAt" DATE NOT NULL,
  "updatedAt" DATE NOT NULL
);

CREATE TABLE "verification" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" DATE NOT NULL,
  "createdAt" DATE NOT NULL,
  "updatedAt" DATE NOT NULL
);

CREATE TABLE "passkey" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT,
  "publicKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "credentialID" TEXT NOT NULL,
  "counter" INTEGER NOT NULL,
  "deviceType" TEXT NOT NULL,
  "backedUp" INTEGER NOT NULL,
  "transports" TEXT,
  "createdAt" DATE,
  "aaguid" TEXT
);

CREATE TABLE "rateLimit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "key" TEXT NOT NULL UNIQUE,
  "count" INTEGER NOT NULL,
  "lastRequest" BIGINT NOT NULL
);

CREATE INDEX "session_userId_idx" ON "session" ("userId");
CREATE INDEX "account_userId_idx" ON "account" ("userId");
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");
CREATE INDEX "passkey_userId_idx" ON "passkey" ("userId");
CREATE UNIQUE INDEX "passkey_credentialID_uidx" ON "passkey" ("credentialID");

CREATE TRIGGER "passkey_limit_before_insert"
BEFORE INSERT ON "passkey"
FOR EACH ROW
WHEN (
  SELECT COUNT(*) FROM "passkey" WHERE "userId" = NEW."userId"
) >= 10
BEGIN
  SELECT RAISE(ABORT, 'PASSKEY_LIMIT_EXCEEDED');
END;

CREATE TRIGGER "installation_admin_before_insert"
BEFORE INSERT ON installation
FOR EACH ROW
WHEN NEW.admin_user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "user" WHERE "id" = NEW.admin_user_id)
BEGIN
  SELECT RAISE(ABORT, 'ADMIN_USER_NOT_FOUND');
END;

CREATE TRIGGER "installation_admin_before_update"
BEFORE UPDATE OF admin_user_id ON installation
FOR EACH ROW
WHEN NEW.admin_user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "user" WHERE "id" = NEW.admin_user_id)
BEGIN
  SELECT RAISE(ABORT, 'ADMIN_USER_NOT_FOUND');
END;

CREATE TRIGGER "sole_admin_before_delete"
BEFORE DELETE ON "user"
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM installation WHERE admin_user_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'SOLE_ADMIN_DELETE_FORBIDDEN');
END;

CREATE TABLE passkey_usage (
  passkey_id TEXT PRIMARY KEY REFERENCES passkey (id) ON DELETE CASCADE,
  last_used_at INTEGER NOT NULL
) STRICT;

CREATE TABLE job_idempotency_keys (
  operation TEXT NOT NULL CHECK (length(operation) BETWEEN 1 AND 100),
  key_sha256 TEXT NOT NULL CHECK (length(key_sha256) = 64),
  job_id TEXT NOT NULL REFERENCES jobs (id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (operation, key_sha256)
) STRICT, WITHOUT ROWID;

CREATE INDEX job_idempotency_job ON job_idempotency_keys (job_id);

CREATE INDEX book_versions_reclamation
ON book_versions(state, reclaimed_at, published_at);

CREATE TABLE book_version_presentations (
  version_id TEXT PRIMARY KEY REFERENCES book_versions(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
  config_revision INTEGER NOT NULL CHECK (config_revision >= 1),
  projection_schema_version INTEGER NOT NULL
    CHECK (projection_schema_version = 1),
  alias TEXT CHECK (
    alias IS NULL OR (
      length(alias) BETWEEN 1 AND 120
      AND alias GLOB '[a-z0-9]*'
      AND alias NOT GLOB '*[^a-z0-9-]*'
      AND alias NOT GLOB '[0-9]*'
    )
  ),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  metadata_json TEXT NOT NULL CHECK (
    json_valid(metadata_json)
    AND json_type(metadata_json) = 'object'
    AND length(CAST(metadata_json AS BLOB)) <= 65536
  ),
  cover_resource_id TEXT CHECK (
    cover_resource_id IS NULL OR cover_resource_id GLOB 'res_*'
  ),
  first_page_id INTEGER NOT NULL CHECK (first_page_id >= 1),
  first_page_alias TEXT CHECK (
    first_page_alias IS NULL OR (
      length(first_page_alias) BETWEEN 1 AND 120
      AND first_page_alias GLOB '[a-z0-9]*'
      AND first_page_alias NOT GLOB '*[^a-z0-9-]*'
      AND first_page_alias NOT GLOB '[0-9]*'
    )
  ),
  toc_preview_json TEXT NOT NULL CHECK (
    json_valid(toc_preview_json)
    AND json_type(toc_preview_json) = 'array'
    AND json_array_length(toc_preview_json) <= 200
    AND length(CAST(toc_preview_json AS BLOB)) <= 262144
  ),
  toc_entry_count INTEGER NOT NULL CHECK (
    toc_entry_count BETWEEN 0 AND 20000
  ),
  projection_sha256 TEXT NOT NULL CHECK (length(projection_sha256) = 64),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (book_id, version_id)
    REFERENCES book_versions(book_id, id) ON DELETE CASCADE,
  FOREIGN KEY (book_id, config_revision)
    REFERENCES config_revisions(book_id, revision) ON DELETE RESTRICT
) STRICT, WITHOUT ROWID;

CREATE INDEX book_version_presentations_book
  ON book_version_presentations(book_id, version_id);

CREATE INDEX book_version_presentations_alias
  ON book_version_presentations(alias)
  WHERE alias IS NOT NULL;

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
