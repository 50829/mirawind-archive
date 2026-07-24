# Data Model: MinerU Public Publishing

## 1. Modeling rules

- SQLite stores coordination, identity, routing indexes, task state and version-scoped
  search data. It does not become an editable copy of Markdown or `book.yaml`.
- Every filesystem path stored in SQLite is a normalized path relative to the configured
  persistent data root. External responses never reveal it.
- Book IDs are stable positive integers because product routes require them. Import, source,
  file, version, job, block and resource IDs are opaque generated identifiers.
- Timestamps are UTC ISO-8601 at API boundaries and integer Unix milliseconds in SQLite.
- Every table uses foreign keys; every connection enables `foreign_keys=ON`, WAL mode and a
  bounded busy timeout. Migrations run offline or before Web/worker startup.
- Better Auth owns its user/session/account/verification/Passkey tables and migrations. The
  application references the sole Better Auth user but never writes credential internals.
  Authentication configuration fixes password length at 16–128 characters and session
  freshness at 300 seconds. A reviewed database constraint prevents more than ten Passkey
  rows for the sole administrator.

## 2. Entity relationships

```text
Installation ──1 administrator──> Better Auth user
Book ──1 current draft──> Config Revision ──> Source Snapshot
Config Revision ──0..1──> Draft Preview
Book ──0..1 current publication──> Book Version
Book ──*──> Source Snapshot ──*──> Original File
Book ──*──> Book Version ──1──> Config Revision
Import ──* candidates; Import ──* Jobs
Book/Import ──* Jobs
Book Version ──* Search rows
Book/Job/Version ──* Audit Events
```

## 3. Core records

### 3.1 `installation`

Singleton row (`id = 1`).

| Field                      | Type                           | Rule                          |
| -------------------------- | ------------------------------ | ----------------------------- |
| `admin_user_id`            | text, nullable until bootstrap | Unique Better Auth user ID    |
| `schema_version`           | integer                        | Application DB schema version |
| `created_at`, `updated_at` | integer                        | UTC milliseconds              |

Invariants:

- Bootstrap succeeds only when no admin is registered and no unrelated Better Auth user
  exists.
- All management authorization requires both a valid session and
  `session.user.id = installation.admin_user_id`.

### 3.2 `books`

| Field                      | Type             | Rule                                             |
| -------------------------- | ---------------- | ------------------------------------------------ |
| `id`                       | integer PK       | Stable public numeric identity                   |
| `alias`                    | text nullable    | Globally unique; not numeric; lowercase slug     |
| `visibility`               | text             | `draft`, `private`, or `public`                  |
| `title_cache`              | text             | Derived from selected config for routing/list UI |
| `draft_source_id`          | text nullable FK | Current durable source snapshot                  |
| `draft_config_revision`    | integer nullable | Current config revision                          |
| `ready_preview_revision`   | integer nullable | Newest successfully built preview                |
| `current_version_id`       | text nullable FK | Sole public/current publication pointer          |
| `unavailable_reason`       | text nullable    | Safe recovery category, never raw error text     |
| `created_at`, `updated_at` | integer          | UTC milliseconds                                 |

Invariants:

- New books start `draft` with no `current_version_id`.
- A public book must have a verified `current_version_id`.
- `title_cache`, alias and draft pointers are indexes of authoritative YAML/snapshots; they
  are refreshed only after schema and semantic validation.
- Changing a public book to `private` takes effect in one transaction and does not rebuild
  or delete its version. New anonymous HTML, asset, search and download requests then fail.

### 3.3 `source_snapshots`

An immutable accepted source bundle.

| Field                    | Type       | Rule                                     |
| ------------------------ | ---------- | ---------------------------------------- |
| `id`                     | text PK    | `src_…` opaque ID                        |
| `book_id`                | integer FK | Owner                                    |
| `main_markdown_path`     | text       | Normalized relative path within snapshot |
| `main_markdown_sha256`   | text       | Lowercase SHA-256                        |
| `source_root_rel_path`   | text       | Relative storage path                    |
| `analysis_version`       | text       | Locked candidate/compiler identity       |
| `created_from_import_id` | text FK    | Provenance                               |
| `created_at`             | integer    | UTC milliseconds                         |

The source directory and registered originals become read-only before this row commits.
Replacing content creates a new snapshot; no job edits a snapshot in place.

### 3.4 `config_revisions`

Immutable index for an authoritative `book.yaml`.

| Field                 | Type         | Rule                               |
| --------------------- | ------------ | ---------------------------------- |
| `book_id`, `revision` | composite PK | Revision starts at 1 and increases |
| `source_id`           | text FK      | Source the configuration describes |
| `schema_version`      | integer      | Supported `book.yaml` schema       |
| `yaml_rel_path`       | text         | Immutable YAML path                |
| `yaml_sha256`         | text         | Lowercase SHA-256                  |
| `created_at`          | integer      | UTC milliseconds                   |

A new administrator edit writes and fsyncs a new YAML file, validates schema plus heading
semantics, inserts the revision, then updates `books.draft_config_revision` in one
transaction that also enqueues its preview job. Unknown fields and unsupported newer schema
versions are rejected. Migration creates a new revision; it never rewrites a published
version.

### 3.5 `draft_previews`

Derived, authenticated preview output for one config revision.

| Field                        | Type             | Rule                              |
| ---------------------------- | ---------------- | --------------------------------- |
| `book_id`, `config_revision` | composite PK/FK  | Captured draft revision           |
| `source_id`                  | text FK          | Captured source                   |
| `state`                      | text             | `building`, `ready`, `failed`     |
| `preview_rel_path`           | text nullable    | Revision-scoped derived directory |
| `diagnostics_rel_path`       | text nullable    | Sanitized structured diagnostics  |
| `created_by_job_id`          | text FK          | Provenance                        |
| `completed_at`               | integer nullable | UTC milliseconds                  |

Preview compilation runs only in the job child. An older `ready` preview may be served to
the administrator with `is_stale=true` while a new revision builds. Publication of revision
N requires a successful validation result for the same source/revision, but the publication
job still builds and validates its own immutable output.

### 3.6 `original_files`

| Field              | Type       | Rule                                        |
| ------------------ | ---------- | ------------------------------------------- |
| `id`               | text PK    | `file_…` opaque ID                          |
| `book_id`          | integer FK | Owner                                       |
| `source_id`        | text FK    | Source snapshot                             |
| `role`             | text       | M1: `mineru_zip`                            |
| `storage_rel_path` | text       | Internal relative path                      |
| `original_name`    | text       | Sanitized metadata only; not used as a path |
| `media_type`       | text       | M1 ZIP MIME type                            |
| `size_bytes`       | integer    | 0 through 2 GiB                             |
| `sha256`           | text       | Strong ETag source                          |
| `created_at`       | integer    | UTC milliseconds                            |

Only explicitly registered records are downloadable. A response filename is generated from
the current display title plus `-mineru.zip`; `original_name` never controls a header
without sanitization.

### 3.7 `imports`

Durable upload/analysis workflow, separate from execution jobs.

| Field                                    | Type                | Rule                    |
| ---------------------------------------- | ------------------- | ----------------------- |
| `id`                                     | text PK             | `imp_…` opaque ID       |
| `state`                                  | text                | See transition table    |
| `upload_rel_path`                        | text                | Preserved durable ZIP   |
| `upload_size_bytes`, `upload_sha256`     | integer/text        | Actual streamed values  |
| `selected_candidate_id`                  | text nullable FK    | Confirmed main Markdown |
| `book_id`                                | integer nullable FK | Created/updated target  |
| `safe_error_code`                        | text nullable       | Stable category         |
| `created_at`, `updated_at`, `expires_at` | integer             | Lifecycle               |

States:

```text
uploading -> uploaded -> analyzing
analyzing -> needs_main_confirmation -> preparing -> draft_ready
analyzing -> preparing -> draft_ready
any pre-draft state -> rejected | canceled | expired
```

`draft_ready` means a durable source snapshot and initial valid `book.yaml` exist; it does
not mean anything is public.

### 3.8 `import_candidates`

| Field              | Type    | Rule                                     |
| ------------------ | ------- | ---------------------------------------- |
| `id`               | text PK | Opaque                                   |
| `import_id`        | text FK | Owner                                    |
| `normalized_path`  | text    | Validated internal POSIX-relative path   |
| `confidence`       | text    | `high`, `generic`, `ambiguous`           |
| `score`            | integer | Diagnostic ordering only                 |
| `evidence_json`    | text    | Versioned, size-bounded safe evidence    |
| `diagnostics_json` | text    | Versioned, size-bounded safe diagnostics |

Candidate evidence may be shown only to the administrator. Raw hostile names are never
logged; UI strings are escaped and length-bounded.

### 3.9 `book_versions`

| Field                                        | Type             | Rule                                                     |
| -------------------------------------------- | ---------------- | -------------------------------------------------------- |
| `id`                                         | text PK          | `ver_…` opaque ID                                        |
| `book_id`                                    | integer FK       | Owner                                                    |
| `source_id`                                  | text FK          | Captured immutable source                                |
| `config_revision`                            | integer FK       | Captured config                                          |
| `predecessor_version_id`                     | text nullable FK | Publication ancestry                                     |
| `state`                                      | text             | `ready`, `published`, `superseded`, `failed`, `corrupt`  |
| `version_rel_path`                           | text             | Immutable complete directory                             |
| `manifest_schema_version`                    | integer          | Supported manifest schema                                |
| `manifest_sha256`                            | text             | Integrity                                                |
| `compiler_version`                           | text             | Reproduction identity                                    |
| `renderer_version`                           | text             | ETag/reproduction identity                               |
| `complete_at`, `published_at`, `verified_at` | integer nullable | Lifecycle                                                |
| `reclaimed_at`                               | integer nullable | Retention tombstone; excludes reads, search and recovery |
| `created_by_job_id`                          | text FK          | Provenance                                               |

`building` lives in `jobs` plus staging, not as a readable version row. A version row is
inserted only after the directory is complete and durable. `ready` is never readable through
public or preview routes merely because files exist.

Transitions:

```text
(staging) -> ready -> published -> superseded
                         |              |
                         +-----------> corrupt
ready -> failed (explicit abandonment; remains non-public until cleanup)
```

Exactly one row referenced by `books.current_version_id` may have `published` state.
Previously published `superseded` assets may remain readable while the book is public;
`ready`, `failed` and `corrupt` assets may not.

### 3.10 `jobs`

| Field                                        | Type             | Rule                                                                                                          |
| -------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------- |
| `id`                                         | text PK          | `job_…` opaque ID                                                                                             |
| `kind`                                       | text             | `analyze_import`, `prepare_draft`, `build_preview`, `build_publish`, `verify_version`, `reconcile`, `reclaim` |
| `state`                                      | text             | `queued`, `running`, `succeeded`, `failed`, `canceled`, `interrupted`                                         |
| `import_id`, `book_id`                       | nullable FK      | Scoped target                                                                                                 |
| `version_id`                                 | text nullable    | Intended/result version                                                                                       |
| `captured_source_id`                         | text nullable    | Stale-build guard                                                                                             |
| `captured_config_revision`                   | integer nullable | Stale-build guard                                                                                             |
| `captured_current_version_id`                | text nullable    | Compare-and-swap guard                                                                                        |
| `retry_of_job_id`                            | text nullable FK | Prior terminal job when this row is a retry                                                                   |
| `attempt`                                    | integer          | Starts at 1                                                                                                   |
| `automatic_retry_count`                      | integer          | 0 or 1                                                                                                        |
| `lease_owner`, `lease_until`, `heartbeat_at` | nullable         | Claim/expiry                                                                                                  |
| `phase`                                      | text             | Stable phase enum                                                                                             |
| `progress_json`                              | text             | Bounded counters only                                                                                         |
| `error_code`, `error_class`                  | text nullable    | Safe category                                                                                                 |
| `error_detail_json`                          | text nullable    | Sanitized, bounded diagnostics                                                                                |
| `requested_cancel_at`                        | integer nullable | Cooperative/forced cancellation                                                                               |
| `created_at`, `started_at`, `finished_at`    | integer nullable | Timings                                                                                                       |

Claiming uses a short write transaction that selects the oldest eligible queued job and
updates it to `running` with a lease only if still queued. M1 permits one globally active
import/build job. Heartbeat updates do not share a long transaction with compilation.

Allowed transitions for one row:

```text
queued -> running -> succeeded | failed | canceled | interrupted
queued -> canceled
```

An automatic or explicit retry inserts a new queued row with `retry_of_job_id`, incremented
`attempt` and the same frozen source input (unless the administrator explicitly begins a new
operation). The prior row remains terminal, so retry history is not overwritten. The chain
may contain at most one `automatic_retry_count = 1`; all further retries are explicit.

### 3.11 `search_fts`

FTS5 virtual table using `tokenize='trigram'` and `detail=full`.

Columns:

- indexed: `title`, `authors`, `heading`, `body`
- `UNINDEXED`: `book_id`, `version_id`, `page_id`, `block_id`, `kind`, `ordinal`

Rows are derived from normalized rendered visible text. The build inserts a deterministic
version-scoped set in the same transaction that creates the `ready` version row. A normal
query uses a bound, double-quoted literal phrase and joins `books` so
`books.current_version_id = search_fts.version_id`; anonymous queries additionally require
`books.visibility = 'public'`.

### 3.12 `search_short_fields`

Small ordinary table for one/two-code-point queries.

| Field                   | Type     | Rule                                |
| ----------------------- | -------- | ----------------------------------- |
| `book_id`, `version_id` | FK/index | Permission and version scope        |
| `page_id`, `block_id`   | nullable | Result target                       |
| `kind`                  | text     | `title`, `author`, or `heading`     |
| `normalized_text`       | text     | NFC/newline-normalized visible text |
| `ordinal`               | integer  | Stable result order                 |

Only this table may use bounded `instr()`/escaped `LIKE` fallback. The query caps input,
result count and rows to the current version. Full body text is never copied into it.

### 3.13 `audit_events`

Append-only operational audit, not a content history.

| Field                             | Type          | Rule                                                               |
| --------------------------------- | ------------- | ------------------------------------------------------------------ |
| `id`                              | integer PK    | Monotonic                                                          |
| `actor_user_id`                   | text nullable | Admin or `system` category                                         |
| `action`                          | text          | Bootstrap, recovery, publish, rollback, visibility, Passkey action |
| `book_id`, `version_id`, `job_id` | nullable      | Opaque correlation                                                 |
| `safe_metadata_json`              | text          | IDs, counts and categories only                                    |
| `created_at`                      | integer       | UTC milliseconds                                                   |

Passwords, cookies, credential material, full Markdown, unsafe raw archive names and private
body content are prohibited.

## 4. Cross-entity validation

- `book.yaml.book_id`, source hash and revision must match `books`,
  `source_snapshots` and `config_revisions`.
- Every manifest page owns at least one block; all page/TOC/resource references resolve;
  all source spans stay inside the selected Markdown; all hashes and compiler identities
  match `version.json`.
- Configured heading levels are 1–4 and continuous; page starts occur only before headings;
  each structure override names a real heading block; aliases meet uniqueness rules.
- Every search row resolves to a manifest page/block and every searchable manifest block has
  the expected search row. Count and ID-set comparison occurs before publication.
- The publication transaction fails if source/config/current-version captures differ from
  current draft/book state or current-revision preview validation is not successful.
- File integrity and authorization are checked before serving a page, asset or original.

For reproducibility of an existing published version, the rebuild receives that version's
frozen `version_id` and manifest `created_at` from `version.json`; canonical serialization
must reproduce the entire manifest hash. Building a distinct new version from unchanged
content intentionally receives a new version identity and is compared using its content-hash
set rather than byte equality of identity-bearing metadata.

## 5. Migration policy

1. Database, `book.yaml`, manifest and `version.json` format versions evolve independently.
2. A database migration is a reviewed SQL file with forward migration, compatibility
   fixture and pre-start backup guidance; Web and worker never run different schema
   versions.
3. A `book.yaml` migration reads one supported version, validates, transforms exactly one
   step, validates again, writes a new immutable revision, fsyncs, then changes the draft
   pointer. Published versions are not rewritten.
4. A manifest migration normally means background rebuild from its authoritative version
   inputs. Unsupported newer manifests are rejected; current-version failure invokes
   book-scoped recovery.
5. A `version.json` migration creates and validates a replacement complete directory before
   an atomic swap; it never mutates a published directory in place.
6. No migration silently drops unknown fields or guesses their meaning.
