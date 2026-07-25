# Data model: Library and Reading Loop

## Authority boundary

`book.yaml` remains the only editable source for title, alias and portable metadata.
`document-manifest.json` remains the derived authority for pages, TOC and resources inside
one immutable version. `books.current_version_id` remains the sole current-version pointer.

`book_version_presentations` is a bounded, versioned SQLite projection. It is never edited
by a user, can be deleted and rebuilt, and is never used to reconstruct `book.yaml`.

## `book_version_presentations`

Migration 6 creates one row per projected immutable version:

| Field                       | Rules                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `version_id`                | Primary key and foreign key to `book_versions.id`                                                                                                                                    |
| `book_id`                   | Positive integer; must match the version                                                                                                                                             |
| `config_revision`           | Positive integer; must match the version                                                                                                                                             |
| `projection_schema_version` | Integer `1` for this feature                                                                                                                                                         |
| `alias`                     | Nullable current-candidate alias; lower-case letters, digits and hyphens; not purely numeric; at most 120 characters                                                                 |
| `title`                     | Required visible title; 1–500 characters                                                                                                                                             |
| `metadata_json`             | Canonical, strictly validated JSON containing only bounded optional subtitle, authors, contributors, description, language, publisher, year, edition and ISBN fields; at most 64 KiB |
| `cover_resource_id`         | Nullable opaque resource ID that must exist in this version's manifest                                                                                                               |
| `first_page_id`             | Positive page ID present in the manifest                                                                                                                                             |
| `first_page_alias`          | Nullable validated page alias                                                                                                                                                        |
| `toc_preview_json`          | Canonical JSON array of at most the first 200 validated TOC entries and at most 256 KiB                                                                                              |
| `toc_entry_count`           | Full validated TOC count, from 0 through 20,000                                                                                                                                      |
| `projection_sha256`         | SHA-256 of the canonical projection payload                                                                                                                                          |
| `created_at`                | Frozen build or reconciliation time in epoch milliseconds                                                                                                                            |

The table has a composite foreign key or checked identity against
`book_versions(book_id, id)` and an index for `book_id, version_id`.

## Projection validation

Generation accepts only:

- a strictly valid supported `book.yaml`;
- a strictly valid supported manifest;
- matching `book_id`, `version_id` and `config_revision`;
- an alias and metadata that satisfy the existing `book.yaml` v1 schema;
- a first page present in `manifest.pages`;
- TOC nodes whose page and block identities exist;
- a cover ID present in `manifest.resources`.

An absent or invalid configured cover becomes `NULL` and the UI uses a title placeholder.
It does not create a broken asset link. Unknown projection schema versions and unknown JSON
fields are rejected.

## Relationships

```text
books.current_version_id
  └─ book_versions.id
       ├─ book_version_presentations.version_id
       ├─ search_fts.version_id
       ├─ search_short_fields.version_id
       └─ source_id → original_files.source_id
```

Public library, details, reader runtime labels and search result titles must resolve the
same chain once per request. Draft/private management cards may use `books.title_cache`
because their response is authenticated and non-cacheable.

## State transitions

```text
validated frozen inputs
  → projection generated in staging
  → ready version + projection + search rows committed together
  → current pointer and current alias promoted together
  → published
  → superseded
  → projection/search reclaimed + version lineage tombstoned
```

Failure before the ready transaction leaves no database version, projection or search rows.
Failure inside that transaction rolls all three back. Failure or alias conflict in the
current-pointer transaction leaves the old version, old alias and old presentation visible.

## Existing-version reconciliation

Migration 6 does not parse files. On worker startup:

1. enumerate unreclaimed `ready`, `published` and `superseded` versions;
2. for missing rows, validate their marker, `book.yaml` and manifest with existing byte
   limits;
3. derive and insert one projection transactionally;
4. if a row exists, recompute and compare the digest without mutating mismatches;
5. verify that a current version's alias matches `books.alias`;
6. exclude a version with an invalid projection from automatic recovery.

One corrupt book does not stop other projections from reconciling. Current public books
without a projection are omitted from cards, contribute only to a generic partial-unavailable
notice, and return a generic book-specific `503` from direct details until repaired.

## Response view models

### Public library entry

- book ID and current canonical key
- current version ID and presentation digest
- title and bounded author display
- cover URL or title-placeholder seed
- first reading URL and details URL

### Public/private details

- public library entry fields
- optional bounded metadata
- at most 200 TOC preview entries plus total count/truncation flag
- current-source original files with safe label, size and protected URL

### Administrator library entry

- numeric book ID and draft title cache
- visibility and current-version availability
- ready preview revision and unavailable flag
- destination chosen from current private reader, ready preview or management page

Administrator entries contain no credentials, file paths, unsafe error details or private
body content.
