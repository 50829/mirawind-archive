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
  ready_preview_revision INTEGER,
  current_version_id TEXT,
  unavailable_reason TEXT CHECK (
    unavailable_reason IS NULL OR length(unavailable_reason) <= 80
  ),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    (draft_config_revision IS NULL AND ready_preview_revision IS NULL)
    OR draft_config_revision IS NOT NULL
  ),
  FOREIGN KEY (draft_source_id) REFERENCES source_snapshots(id),
  FOREIGN KEY (id, draft_config_revision)
    REFERENCES config_revisions(book_id, revision),
  FOREIGN KEY (id, ready_preview_revision)
    REFERENCES draft_previews(book_id, config_revision),
  FOREIGN KEY (current_version_id) REFERENCES book_versions(id)
) STRICT;

CREATE TABLE imports (
  id TEXT PRIMARY KEY CHECK (id GLOB 'imp_*'),
  state TEXT NOT NULL CHECK (
    state IN (
      'uploading',
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
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
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
      'build_preview',
      'build_publish',
      'verify_version',
      'reconcile',
      'reclaim'
    )
  ),
  state TEXT NOT NULL CHECK (
    state IN ('queued', 'running', 'succeeded', 'failed', 'canceled', 'interrupted')
  ),
  import_id TEXT REFERENCES imports(id) ON DELETE RESTRICT,
  book_id INTEGER REFERENCES books(id) ON DELETE RESTRICT,
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
  progress_json TEXT NOT NULL DEFAULT '{}'
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
  requested_cancel_at INTEGER,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  CHECK (
    (state = 'running' AND lease_owner IS NOT NULL AND lease_until IS NOT NULL)
    OR state != 'running'
  ),
  FOREIGN KEY (book_id, captured_config_revision)
    REFERENCES config_revisions(book_id, revision),
  FOREIGN KEY (version_id) REFERENCES book_versions(id),
  FOREIGN KEY (captured_current_version_id) REFERENCES book_versions(id)
) STRICT;

CREATE TABLE draft_previews (
  book_id INTEGER NOT NULL,
  config_revision INTEGER NOT NULL,
  source_id TEXT NOT NULL REFERENCES source_snapshots(id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN ('building', 'ready', 'failed')),
  preview_rel_path TEXT,
  diagnostics_rel_path TEXT,
  created_by_job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  completed_at INTEGER,
  PRIMARY KEY (book_id, config_revision),
  FOREIGN KEY (book_id, config_revision, source_id)
    REFERENCES config_revisions(book_id, revision, source_id)
) STRICT, WITHOUT ROWID;

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
    state IN ('ready', 'published', 'superseded', 'failed', 'corrupt')
  ),
  version_rel_path TEXT NOT NULL UNIQUE,
  manifest_schema_version INTEGER NOT NULL CHECK (manifest_schema_version >= 1),
  manifest_sha256 TEXT NOT NULL CHECK (length(manifest_sha256) = 64),
  compiler_version TEXT NOT NULL CHECK (length(compiler_version) <= 100),
  renderer_version TEXT NOT NULL CHECK (length(renderer_version) <= 100),
  complete_at INTEGER NOT NULL,
  published_at INTEGER,
  verified_at INTEGER,
  created_by_job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
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
CREATE INDEX books_visibility_current ON books(visibility, current_version_id);
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
