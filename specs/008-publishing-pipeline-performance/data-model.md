# Data Model: Publishing Pipeline Performance

## Authoritative and Derived Data

- Authoritative: normalized main Markdown and `book.yaml` v3 for one immutable source/config revision.
- Derived and rebuildable: `CompiledBook`, rendered pages, manifest v2, version marker v2, preview and
  public shells, assets, search rows, presentation and diagnostics.
- Server lifecycle only: jobs, draft candidate attempts, immutable book versions and audit events.

## Core Values

### BuildCandidateCommand

Immutable worker command containing `jobId`, `candidateId`, `versionId`, `bookId`, `sourceId`,
`configRevision`, `capturedCurrentVersionId`, relative source/config roots and compiler/renderer
identities plus the preview and reader asset identities. It contains no nullable fields unrelated to
`build_candidate` and no body content.

Validation binds every relative path to the job/book storage root, every ID to its opaque-ID family,
and the source/config pair to one database revision before the child starts.

### CompiledBook

The only whole-book in-memory build model:

- parsed normalized document tree and ordered root blocks;
- configured heading tree and stable block identities;
- `PagePlan[]` with page ID, ordinal, start/end block indexes and navigation identities;
- logical resource descriptors, not copied resource bytes;
- semantic/compiler/renderer identities;
- deterministic book-level diagnostics and digests.

`CompiledBook` is immutable by convention and never persisted. It does not contain preview/public
URLs, database repositories, filesystem handles, Astro/React values or one document copy per page.

### RenderedPage

One route-neutral page result with page identity/ordinal, typed Reader page model, logical-resource
HTML, TOC/breadcrumb/outline/navigation, renderer asset requirements, search rows and ordered
diagnostics. It is consumed once and released after its preview/public materializations and
manifest/search entries are written.

### CandidateBuildArtifact

Strict child-to-parent result containing only opaque IDs, version-relative artifact root, semantic
digest, manifest/version-marker hashes, page/resource/search/diagnostic counts, blocking count and
compiler/renderer/preview/reader identities. Strings and collections have explicit size/count limits.
It never contains full HTML, Markdown, titles, raw archive paths or resource bytes.

## Persistent Entities

### DraftCandidate

| Field                           | Rule                                                                  |
| ------------------------------- | --------------------------------------------------------------------- |
| `id`                            | opaque `candidate_*`, primary key                                     |
| `book_id`                       | required book                                                         |
| `source_id` / `config_revision` | immutable authoritative input pair                                    |
| `job_id`                        | unique current attempt job                                            |
| `version_id`                    | nullable until durable candidate registration; unique when present    |
| `state`                         | `building`, `ready`, `failed`, `canceled`, `interrupted`, `discarded` |
| `semantic_digest`               | required only when ready                                              |
| `safe_error_code`               | bounded and content-free terminal reason                              |
| timestamps                      | created plus terminal timestamp                                       |

`books.current_candidate_id` identifies the only attempt eligible to become ready for the current
draft revision. A newer save or retry updates this pointer; an older completion becomes `discarded`
and cannot become publishable.

### BookVersion

An immutable candidate/publication record with source/config/predecessor identity, artifact path,
manifest and semantic digests, compiler/renderer identities and lifecycle state:

```text
ready ──publish──> published ──new publish──> superseded
  │
  └──newer candidate/delete──> discarded
published/superseded ──verification failure──> corrupt
superseded/discarded ──reclaim──> reclaimed_at set
```

Only one non-reclaimed `ready` candidate and one `published` version may exist for a book. A ready
candidate is not visible to public search or reader routes until promotion.

### Job

The build kind is `build_candidate`; `build_preview` and `build_publish` do not exist. Its closed
phase sequence is `queued → starting → compile_book → render_pages → build_search →
finalize_candidate → succeeded`, with existing terminal failure/cancel/interruption semantics.
Progress remains bounded `{completed,total,unit,processed_bytes}` and phase transitions are monotonic.

## Relationships

```text
Book ──current draft──> SourceSnapshot + ConfigRevision
Book ──current_candidate_id──> DraftCandidate ──job_id──> Job
DraftCandidate ──version_id──> BookVersion
Book ──current_version_id──> published BookVersion
BookVersion ──1:1──> Presentation
BookVersion ──1:n──> Search rows and immutable files
```

## Transaction and Recovery Rules

1. Saving a revision writes immutable config files, then one transaction registers the revision,
   creates `DraftCandidate(building)` and `Job(build_candidate)`, and updates
   `books.current_candidate_id`.
2. After candidate tree fsync/rename, one transaction verifies current attempt and lease, registers
   `BookVersion(ready)`, search and presentation, changes `DraftCandidate` to `ready`, and completes
   the job. A stale attempt is registered/discarded or reclaimed without changing the book pointer.
3. Publishing checks revision, candidate/version link, semantic identity, policy, blocking diagnostics
   and predecessor, then one immediate transaction promotes the version and records one audit event.
4. A repeated publish of the already-current candidate returns the existing success without a new
   event. Any mismatch leaves `current_version_id` unchanged.
5. Reconciliation never infers publication. It removes unregistered staging/version trees, marks lost
   attempts terminal, verifies registered candidates, and queues only authorized cleanup/verification.
