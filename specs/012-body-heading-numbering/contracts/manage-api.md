# Management Draft API: Numbering Extension

## `GET /api/manage/books/:bookId/draft`

Adds one required field to the authenticated draft representation:

```json
{
  "numbering": "source"
}
```

The value is read from the current immutable `book.yaml` revision. Existing administrator authorization,
hidden 404, ETag, no-index and `private, no-store` behavior is unchanged.

## `PATCH /api/manage/books/:bookId/draft`

The strict top-level patch accepts optional `numbering` plus the existing fields. `changes` remains required:

```json
{
  "numbering": "generated",
  "changes": []
}
```

Allowed values are exactly `source`, `generated` and `none`. Unknown values or fields return the existing
typed `400 DRAFT_PATCH_INVALID` response and create no revision or job.

The request requires the existing `If-Match` config ETag and same-origin administrator session. A stale or
missing ETag returns `412 DRAFT_PRECONDITION_FAILED` without overwriting the current revision. An accepted
request returns `202` with the existing candidate and config-revision projection plus the next ETag.

```json
{
  "book_id": 42,
  "candidate": {
    "attempt_id": "attempt_opaque",
    "job_id": "job_opaque",
    "state": "building"
  },
  "config_revision": 8
}
```

The operation writes `publishing.numbering.mode` into a new validated config revision and schedules the one
existing candidate build. It does not rewrite Markdown, mutate a published version or expose new content.
