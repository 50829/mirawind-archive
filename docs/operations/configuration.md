# Runtime configuration

Development and deployment use the same `MIRAWIND_*` variables and environment parser. Node commands
load `.env` with `--env-file-if-exists`; explicitly supplied process variables take precedence.
`.env.example` supplies local values. Deployment uses the same keys with the host's paths, HTTPS
origin and secret. Compose overrides the data path with its container volume mount.

| Variable                 | Secret | Required | Rule                                                                                         |
| ------------------------ | ------ | -------- | -------------------------------------------------------------------------------------------- |
| `MIRAWIND_DATA_DIR`      | No     | Yes      | Persistent directory; development accepts relative paths, deployment requires absolute paths |
| `MIRAWIND_PUBLIC_ORIGIN` | No     | Yes      | Exact HTTPS origin; HTTP is allowed only for localhost development                           |
| `MIRAWIND_PASSKEY_RP_ID` | No     | Yes      | Hostname covered by the public origin, without scheme or port                                |
| `MIRAWIND_ALLOWED_HOSTS` | No     | Yes      | Comma-separated exact hosts accepted by the development server/proxy boundary                |
| `MIRAWIND_AUTH_SECRET`   | Yes    | Yes      | At least 32 random bytes; never committed or logged                                          |

`MIRAWIND_LOCAL_DEVELOPMENT_TRUST=1` is an internal launcher-owned development marker. Do not add it
to `.env.example` or remote deployment configuration. `pnpm dev` and `docker/local.sh` set it for the
Web process they own.

`localDevelopmentTrust` is enabled only when the marker is present, the runtime mode is `development`,
`MIRAWIND_PUBLIC_ORIGIN` is loopback and every `MIRAWIND_ALLOWED_HOSTS` entry is loopback. In that exact
mode the Web process resolves the initialized sole administrator without a login cookie. Container-internal
`HOST=0.0.0.0` does not change this decision; the local Compose contract publishes Web only on the host
loopback interface. `test` and `production` always disable the trust path, including built servers on
localhost or environments that accidentally carry the marker.

Formal Better Auth sessions last 90 days and refresh after 7 days of activity. Session freshness for
sensitive credential operations remains 5 minutes.

Use `pnpm dev` for the complete local runtime. The example `.env` selects `http://127.0.0.1:4322`
and persistent `data/development`. The command enables development mode and local trust, applies
migrations and initializes a local-only administrator when the directory is new. Data, origin,
allowed hosts, RP ID and auth secret come from the shared configuration; the launcher does not
replace them or create a new auth secret on restart. The separate `dev:web` and `dev:worker` scripts
are diagnostic tools and require explicit configuration.
The managed development server also uses a Vite dependency cache isolated from checks, tests, and
builds, so running repository verification does not invalidate active React islands.
`pnpm dev` keeps Web in the foreground using Astro's `dev()` API and starts serving only after
the worker is ready. Keep that terminal running; `Ctrl+C` stops both processes. A duplicate data
directory or occupied port fails startup instead of attaching to another runtime. Astro CLI
background commands (`astro dev status/stop/logs`) do not manage this API-owned runtime.
Data directories, caches and large import fixtures are excluded from hot-reload file watching.
Local security settings display the development login status; credential management is available
only through a real authenticated session on the corresponding deployment.

`data/development` contains the database and books, not disposable cache. Git ignores it, but cache
cleanup must not remove it. To move an older `.cache/dev-data` installation, stop Web and worker,
copy the complete directory to `data/development`, and retain the original until verification.
Alternatively point `MIRAWIND_DATA_DIR` at that installation until it is moved.

Web and worker receive the same data directory and schema-compatible configuration. Only
the Web process receives public traffic. Caddy overwrites trusted forwarding headers and
the Node origin is not published directly.

Do not pass passwords, cookies, Passkey material, private Markdown, or recovery credentials
through command arguments or environment variables. Administrator bootstrap and recovery
read passwords from a hidden interactive TTY.

Configuration is validated at process startup and invalid production configuration refuses
to start. The Compose deployment initializes data-volume ownership and migrations before
starting Web/worker; see `deployment.md`.
