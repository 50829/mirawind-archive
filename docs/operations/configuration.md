# Runtime configuration

Mirawind receives runtime configuration through explicit environment variables. Copy
`.env.example` for local development only; production secrets belong in the host or
orchestrator secret store.

| Variable                 | Secret | Required | Rule                                                                          |
| ------------------------ | ------ | -------- | ----------------------------------------------------------------------------- |
| `MIRAWIND_DATA_DIR`      | No     | Yes      | Absolute persistent directory outside the application image                   |
| `MIRAWIND_PUBLIC_ORIGIN` | No     | Yes      | Exact HTTPS origin; HTTP is allowed only for localhost development            |
| `MIRAWIND_PASSKEY_RP_ID` | No     | Yes      | Hostname covered by the public origin, without scheme or port                 |
| `MIRAWIND_ALLOWED_HOSTS` | No     | Yes      | Comma-separated exact hosts accepted by the development server/proxy boundary |
| `MIRAWIND_AUTH_SECRET`   | Yes    | Yes      | At least 32 random bytes; never committed or logged                           |

`localDevelopmentTrust` is derived, not configured. It is enabled only when the runtime mode is
`development`, `MIRAWIND_PUBLIC_ORIGIN`, every `MIRAWIND_ALLOWED_HOSTS` entry and `HOST` (when set)
are loopback values. In that exact mode the Web process resolves the initialized sole administrator
without a login cookie. `test` and `production` always disable the trust path, including production
builds served on localhost.

Formal Better Auth sessions last 90 days and refresh after 7 days of activity. Session freshness for
sensitive credential operations remains 5 minutes.

Web and worker receive the same data directory and schema-compatible configuration. Only
the Web process receives public traffic. Caddy overwrites trusted forwarding headers and
the Node origin is not published directly.

Do not pass passwords, cookies, Passkey material, private Markdown, or recovery credentials
through command arguments or environment variables. Administrator bootstrap and recovery
read passwords from a hidden interactive TTY.

Configuration is validated at process startup and invalid production configuration refuses
to start. The Compose deployment initializes data-volume ownership and migrations before
starting Web/worker; see `deployment.md`.
