ALTER TABLE book_versions
ADD COLUMN reclaimed_at INTEGER
CHECK (reclaimed_at IS NULL OR reclaimed_at >= 0);

CREATE INDEX book_versions_reclamation
ON book_versions(state, reclaimed_at, published_at);
