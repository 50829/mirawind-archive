# Contract: Management preview

All routes require the administrator, return `private, no-store`, prohibit indexing and do
not reveal draft existence to anonymous callers.

## `GET /api/manage/books/:bookId/draft`

The existing response adds the following ready-preview fields:

```json
{
  "preview": {
    "config_revision": 2,
    "source_sha256": "64 lowercase hex characters",
    "config_sha256": "64 lowercase hex characters",
    "compiler_version": "compiler-v3",
    "renderer_version": "semantic-html-v3-katex-0.18.1",
    "semantic_digest": "64 lowercase hex characters",
    "source_regions": [
      {
        "region_id": "region_opaque",
        "kind": "printed_toc",
        "confidence": "high",
        "start_byte": 4096,
        "end_byte": 16384,
        "entry_count": 81,
        "matched_heading_count": 79,
        "conflict_count": 2,
        "applied": true
      }
    ],
    "typography": {
      "profile": "zh-smart-v1",
      "input_sha256": "64 lowercase hex characters",
      "output_sha256": "64 lowercase hex characters",
      "spaces_normalized": 128,
      "punctuation_converted": 42,
      "protected_nodes": 17
    },
    "pages": [],
    "headings": []
  },
  "diagnostics": [
    {
      "code": "PRINTED_TOC_UNMATCHED_ENTRY",
      "severity": "warning",
      "path": "source_regions/0",
      "message": "One printed contents entry was not applied."
    }
  ]
}
```

Arrays, strings and counters remain bounded. Typography data is aggregate-only. Diagnostic
messages do not contain complete source content or unsafe archive paths.

## Preview pages and assets

- `GET /api/manage/books/:bookId/preview/:configRevision/pages/:pageId`
- `GET /api/manage/books/:bookId/preview/:configRevision/assets/:resourceId`

They continue to read generated private artifacts only. Page count and page IDs match the
semantic compilation that publication will use. Preview HTML links the same versioned
renderer stylesheet as published HTML.

## `PUT /api/manage/books/:bookId/draft`

The existing strong `If-Match` precondition remains. A v1 draft may be submitted through
the in-memory v2 migration. Region changes create a new immutable config revision and queue
a new preview. An explicit re-preprocess operation starts from the immutable original import
and creates a new source/configuration revision before queueing preview; a configuration
edit cannot pretend to change the already-applied profile. Invalid range/digest/structure
combinations or preprocessing provenance return a bounded validation error and create no
revision.

## `POST /api/manage/books/:bookId/publish`

Publication is accepted only when the ready preview matches:

- current source ID and Markdown digest;
- expected configuration revision and YAML digest;
- current compiler and renderer identity;
- a valid semantic digest.

A mismatch returns `409 PUBLISH_PREVIEW_STALE`, queues no publication and leaves the current
version untouched.

## Re-preprocess

The administrator action that reapplies a typography profile is not a config-only `PUT`.
It follows the source snapshot, concurrency, atomicity and failure contract in
`source-preprocessing.md`.
