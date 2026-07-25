# Contract: Permanent Book Deletion API

## Library capability

`GET /api/manage/library`

- Authentication: required administrator session.
- Authorization: sole administrator only.
- Cache: `Cache-Control: private, no-store`.
- Indexing: not indexable.

Each active entry adds:

```json
{
  "deletion": {
    "allowed": true,
    "mutationToken": "opaque-bounded-token"
  }
}
```

Deleting books are omitted. The token contains no recoverable title or content.

## Accept deletion

`DELETE /api/manage/books/:bookId`

- Authentication: required administrator session; recent-auth age is not checked.
- Authorization: sole administrator only.
- CSRF/origin: existing same-origin mutation check required.
- Cache: request and every response are `private, no-store`.
- Indexing: not indexable.
- Headers:
  - `Content-Type: application/json`
  - `Idempotency-Key: <bounded opaque client key>`
  - `If-Match: "<mutation-token>"`
- Body:

```json
{
  "confirmationTitle": "Current displayed title"
}
```

Server processing:

- validate the opaque book ID before lookup;
- normalize the submitted and current title to NFC, then compare exactly;
- validate the strong mutation token before creating any state;
- never echo the submitted or current title in response, error, audit or logs.

### `202 Accepted`

Returned for the first accepted request and an exact idempotent replay:

```json
{
  "deletionId": "del_opaque",
  "jobId": "job_opaque",
  "state": "pending",
  "taskUrl": "/manage/tasks/job_opaque"
}
```

The response may report the current safe state (`pending`, `purging`, `failed`,
`completed`) on replay. It never contains title, alias, filename, path or arbitrary job
error.

### Failure classes

| Status | Condition | Disclosure |
|---:|---|---|
| 400 | malformed body/header/idempotency key | bounded generic validation error |
| 401 | missing/invalid session | existing generic authentication response |
| 404 | absent, private to another identity, deleting or deleted subject | generic missing response |
| 409 | idempotency key reused for a different intent | generic idempotency conflict |
| 412 | stale mutation token or changed title/state | generic stale-confirmation response |
| 415 | unsupported body content type | generic media-type response |

All failures create no deletion/tombstone/job state unless they are an exact replay of an
already accepted operation.

## Task status and retry

The existing authenticated task endpoint and retry mutation are reused.

- A deletion cleanup task exposes only deletion ID, job ID, safe state, safe phase,
  timestamps, bounded numeric progress and allowlisted error code.
- It does not expose the former book title, alias, filename, path or body.
- Retry is available only for a failed cleanup with a non-completed tombstone.
- Retry creates/leases cleanup work for the same irreversible tombstone and cannot restore
  or expose the book.
- A completed deletion retry is rejected as already complete.
