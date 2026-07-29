# Management API Contract

All routes require the sole administrator, return private/no-store responses and forbid
indexing unless a hidden 404 is specified.

## Import status

`GET /api/manage/imports/:id` returns the import, candidate confirmation, current job and
matching preview `{ state, revision, url }` from one database snapshot.

## Draft projection

`GET /api/manage/books/:id/draft` returns an ETag plus title, current revision, structure,
source-region summaries, current preview projection, current preview state and locatable
diagnostics. It does not return complete source/configuration/original-file identities.

## Draft patch

`PATCH /api/manage/books/:id/draft` requires `If-Match`.

```json
{
  "changes": [
    {
      "block_id": "blk_...",
      "display_title": "Optional override",
      "display_level": 2,
      "include_in_toc": true,
      "starts_page": true,
      "role": "body"
    }
  ]
}
```

Missing fields are unchanged. Explicit null deletes optional overrides. Unknown fields,
duplicate IDs and unknown IDs are rejected. Success returns `202` with the new revision,
preview job ID and building state. A stale ETag returns `412` without discarding client
edits.

D-116 supersedes the earlier source-region patch field. Source regions are automatic,
read-only preparation output; this endpoint rejects region, canonical, body-match and
inferred-hierarchy adjudication fields.

## Reprocess

`POST /api/manage/books/:id/reprocess` accepts only expected configuration revision and the
target typography profile. Source and original identities are resolved by the server.

## Preview page and asset

Preview page GET requires the active administrator session and current ready revision.
Generated asset URLs carry a short-lived authorization. Asset GET validates that
authorization and returns hidden no-store 404 for invalid, expired, logged-out, deleted or
stale requests.
