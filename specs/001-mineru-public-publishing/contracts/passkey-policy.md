# Passkey management policy contract

Better Auth owns WebAuthn ceremonies and the `/api/auth/*` protocol surface. Mirawind does
not proxy, duplicate or reimplement registration/authentication cryptography. This contract
defines the application policy applied around the locked Better Auth endpoints.

## Fixed authentication policy

- `emailAndPassword.minPasswordLength = 16`
- `emailAndPassword.maxPasswordLength = 128`
- `session.freshAge = 300` seconds
- at most 10 Passkeys for the sole administrator
- Passkey registration requires an existing authenticated session
- public signup and Web recovery remain disabled

Password validation does not impose uppercase/lowercase/digit/symbol composition. The UI and
offline CLI recommend at least 24 random characters from a password manager.

## Better Auth endpoints used

| Operation | Better Auth endpoint | Mirawind policy |
|---|---|---|
| Passkey sign-in or reauthentication | `POST /api/auth/sign-in/passkey` | Successful sign-in creates the server-timed fresh session |
| Password sign-in or reauthentication | `POST /api/auth/sign-in/email` | Password policy applies; successful sign-in creates the fresh session |
| Registration ceremony | `POST /api/auth/passkey/add-passkey` and its option/verification flow | Existing session, freshness <=300 seconds, registration still below 10 |
| List | `GET /api/auth/passkey/list-user-passkeys` | Sole administrator only; response is never cacheable |
| Rename | `POST /api/auth/passkey/update-passkey` | Sole administrator and freshness <=300 seconds |
| Delete non-final | `POST /api/auth/passkey/delete-passkey` | Sole administrator and freshness <=300 seconds |

The application installs Better Auth before-hooks for the mutation endpoints. The Passkey
table migration also enforces the ten-key ceiling at the database boundary so concurrent
registration attempts cannot create an eleventh credential.

## Final-Passkey deletion

Deleting the final Passkey does not call the generic delete endpoint directly. The
management UI performs a dedicated application action:

```text
POST /api/manage/security/passkeys/{passkeyId}/delete-final
Content-Type: application/json
Origin: <exact configured origin>

{ "current_password": "<fallback password>" }
```

The endpoint:

1. requires the current sole-administrator session and exact origin;
2. verifies the supplied password through Better Auth without logging or retaining it;
3. rechecks in one write transaction that the target is still the administrator's sole
   Passkey;
4. deletes it through the locked Better Auth adapter/API;
5. records only a safe audit event and returns `204`;
6. returns non-cacheable `401`, `403`, `404`, or `409` for authentication, ownership,
   missing-target, or concurrent-count changes.

The password is never accepted through query parameters, command arguments, environment
variables, logs or audit metadata.

## Test obligations

- Boundary tests at 299, 300 and 301 seconds use server time.
- Two concurrent registration completions cannot produce more than 10 rows.
- Rename/delete/add with a stale session fail before mutation.
- Final deletion fails without the correct password even when the session is fresh.
- Generic deletion cannot bypass the final-key policy.
- All list/mutation/error responses use `private, no-store`.
