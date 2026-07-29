# HTTP API Contract Changes

All routes require the administrator session and same-origin mutation protection. Responses use
`Cache-Control: private, no-store` and `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet`.

## Save Draft

`PATCH /api/manage/books/:bookId/draft`

- Requires `If-Match` for the current draft ETag.
- Performs bounded request/schema/reference validation only; it does not parse or compile the whole
  Markdown document.
- Persists the immutable revision and creates exactly one current candidate attempt/job transaction.
- Returns `202` with the new ETag:

```json
{
  "revision": 3,
  "candidate": {
    "attempt_id": "candidate_opaque",
    "job_id": "job_opaque",
    "state": "building"
  }
}
```

## Draft Projection

`GET /api/manage/books/:bookId/draft` returns the existing workbench projection plus:

```json
{
  "candidate": {
    "attempt_id": "candidate_opaque",
    "revision": 3,
    "state": "building|ready|failed|canceled|interrupted",
    "version_id": null,
    "semantic_digest": null,
    "preview_url": null,
    "safe_error_code": null
  }
}
```

Ready fields become non-null together. Stale candidate output is never returned as current preview.

## Publish Candidate

`POST /api/manage/books/:bookId/publish`

```json
{
  "expected_config_revision": 3,
  "expected_candidate_version_id": "ver_opaque"
}
```

- Synchronously validates policy, revision, current candidate, version identity, predecessor and
  blocking diagnostics.
- Atomically promotes the named version and returns `200`:

```json
{
  "version_id": "ver_opaque",
  "state": "published",
  "published_at": 1785350000000
}
```

- Repeating the request for the already-current candidate returns the same success without a second
  audit event.
- Stale/failed/discarded/blocking candidates return a private non-cacheable `409` or policy `403` and
  leave the public pointer unchanged.
- The endpoint creates no job and accepts no legacy `build_publish` response shape.
