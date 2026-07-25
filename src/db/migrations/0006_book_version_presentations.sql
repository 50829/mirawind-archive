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
