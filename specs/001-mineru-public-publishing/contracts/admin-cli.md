# Offline administrator CLI contract

The administrator bootstrap and complete-recovery commands are server-local operations.
They are never HTTP endpoints and must not be callable through the Web process.

## Invocation

The planned package exposes:

```bash
pnpm mirawind admin bootstrap --data-dir /srv/mirawind/data
pnpm mirawind admin recover --data-dir /srv/mirawind/data
```

Only non-secret configuration may be supplied as arguments. Email, display name and password
are read interactively from a TTY; passwords use hidden input and confirmation. If stdin or
stderr is not a TTY, the command refuses to run. Fallback passwords must contain 16–128
characters; the prompt recommends at least 24 random characters from a password manager and
does not require a character-class composition rule.

## `admin bootstrap`

Preconditions:

- Web and worker processes are stopped.
- The configured data directory and SQLite file pass owner/permission checks.
- Database migrations are current.
- No `installation.admin_user_id` and no Better Auth user already exist.

Behavior:

1. Acquire an exclusive application maintenance lock.
2. Prompt for administrator email, display name and a long fallback password.
3. Use a setup-only Better Auth instance to create the password account; never write a
   credential hash directly.
4. In one transaction, register the returned user ID as the sole administrator and append
   an audit event.
5. Print the administrator identity and next login URL, but never echo the password,
   session, hash or recovery material.

Running bootstrap a second time fails without modifying data.

## `admin recover`

Preconditions:

- Web and worker processes are stopped.
- A sole administrator is registered.
- The caller confirms the destructive credential reset at the TTY.

Behavior:

1. Acquire the same exclusive maintenance lock.
2. Prompt for a new 16–128-character fallback password and confirmation.
3. Use Better Auth's supported password APIs/schema.
4. In one database transaction, revoke every session and remove every Passkey belonging to
   the sole administrator; commit the new password/account state consistently.
5. Append a safe audit event and print that the administrator must log in with the new
   password and register new Passkeys.

Recovery does not change books, versions, jobs, sources, publication visibility or files.
There is no email, SMS, recovery-code or Web recovery path.

## Exit codes

| Code | Meaning |
|---:|---|
| `0` | Completed successfully |
| `2` | Invalid arguments or no interactive TTY |
| `3` | Preconditions failed (running service, wrong schema, already/not initialized) |
| `4` | Authentication-library validation failed |
| `5` | Storage, lock or transaction failure; no partial success may be reported |

All stderr messages use stable safe categories. Debug logging must not include prompt input,
credential material, cookies, database tokens or complete database rows.
