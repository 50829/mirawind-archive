# Library Management Capability

`GET /api/library/management-capability`

- Anonymous, invalid, or non-administrator session: `200` with
  `{ "management_available": false }`.
- Administrator session: `200` with `{ "management_available": true }`.
- Response uses the existing private API no-store/no-index headers.
- Response contains no account, session, library, or mutation data.
- A true value only triggers the existing protected `GET /api/manage/library`, which repeats
  full authorization.
