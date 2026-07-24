# Deployment and operations

This runbook deploys the frozen M1 topology: one Linux host, one Astro Web process, one
worker, one SQLite WAL database, one local persistent data root and Caddy. Do not use
`docker compose up --scale`, run a second worker, or place the SQLite volume on a network
filesystem.

## 1. Prerequisites

- x86-64 or arm64 Linux with adequate local SSD space;
- Docker Engine with the Compose plugin;
- a DNS name pointing to the host and inbound TCP 80/443;
- enough memory for the largest expected build (the M1 reference peak is recorded in
  `docs/audits/m1-performance-report.md`);
- a host backup destination separate from the live Docker volume.

Clone the repository and create `.env` from `.env.example`. The file must not be committed
and should be readable only by the deployment administrator.

```bash
cp .env.example .env
chmod 0600 .env
```

Set:

- `MIRAWIND_PUBLIC_ORIGIN` to the exact external HTTPS origin;
- `MIRAWIND_PASSKEY_RP_ID` to the same hostname, without scheme or port;
- `MIRAWIND_ALLOWED_HOSTS` to the exact accepted hostname(s);
- `MIRAWIND_AUTH_SECRET` to at least 32 random high-entropy bytes.

The fallback administrator password is not an environment variable. It is entered only in
the offline interactive CLI.

## 2. First installation

Build the pinned image, initialize volume ownership and apply every checksummed migration:

```bash
docker compose -f docker/compose.yaml build
docker compose -f docker/compose.yaml run --rm data-init
docker compose -f docker/compose.yaml run --rm migrate
```

Create the sole administrator before starting the long-running services:

```bash
docker compose -f docker/compose.yaml run --rm --no-deps web \
  node dist/processes/cli/index.js admin bootstrap \
  --data-dir /var/lib/mirawind
```

The command requires a TTY and prompts for email, display name and a 16–128 character
fallback password. It refuses a second bootstrap.

Start the stack:

```bash
docker compose -f docker/compose.yaml up -d
docker compose -f docker/compose.yaml ps
```

The startup dependency chain is `data-init → migrate → web → worker`; Caddy starts after
Web is healthy. `data-init` and `migrate` must exit successfully. Web and worker must report
`healthy`. Caddy is the only public service.

## 3. Container boundary

Web and worker run as UID/GID 10001 with:

- a read-only application root;
- all Linux capabilities dropped;
- `no-new-privileges`;
- a small, private, `noexec` tmpfs at `/tmp`;
- `/var/lib/mirawind` as the only persistent writable volume;
- an init process for signal forwarding and child reaping;
- a 20-second container stop grace period, longer than the worker's 10-second child
  termination grace.

The worker still owns its per-job process group and enforces cancellation, the 30-minute
timeout and forced group termination. Docker health checks also run as UID 10001. The
root-only `data-init` service has no network, runs once, and retains only the capabilities
needed to correct data-volume ownership.

## 4. Persistent layout

The named volume is mounted at `/var/lib/mirawind`:

```text
/var/lib/mirawind/
├── db/mirawind.sqlite{,-wal,-shm}
├── backups/
├── books/<book_id>/
│   ├── draft/
│   │   ├── sources/<source_id>/
│   │   ├── originals/<file_id>
│   │   ├── configs/<revision>/book.yaml
│   │   └── previews/<revision>/
│   ├── quarantine/
│   └── versions/<version_id>/
├── staging/<job_id>/
└── tmp/
```

Actual layout is always determined by the runtime code and opaque IDs; do not infer identity
from titles or paths. `staging`, `versions` and uploads must stay on the same filesystem so
publication rename is atomic. Never expose this volume through Caddy as a static directory.

Published version directories are immutable. Do not edit `book.yaml`, manifest, HTML,
resources or `version.json` in place. Correct source/configuration through a new import or
revision and publish a new version.

## 5. Lifecycle commands

Inspect status and bounded logs:

```bash
docker compose -f docker/compose.yaml ps
docker compose -f docker/compose.yaml logs --tail=200 web worker caddy
```

Restart only the failed long-running process; never start a second copy:

```bash
docker compose -f docker/compose.yaml restart web
docker compose -f docker/compose.yaml restart worker
```

Normal shutdown:

```bash
docker compose -f docker/compose.yaml stop worker web
```

Stop worker first when performing offline administration. A running build receives
cooperative shutdown; after restart an expired lease is marked interrupted and only an
eligible infrastructure interruption is retried, at most once.

## 6. Upgrade and migration

Before every upgrade, take a complete persistent-volume backup as described in
`recovery.md`. Then:

```bash
docker compose -f docker/compose.yaml stop worker web
git pull --ff-only
docker compose -f docker/compose.yaml build
docker compose -f docker/compose.yaml run --rm data-init
docker compose -f docker/compose.yaml run --rm migrate
docker compose -f docker/compose.yaml up -d
docker compose -f docker/compose.yaml ps
```

`migrate` acquires the schema lock, creates an online SQLite backup for an existing database,
verifies migration checksums and applies only newer versions. Migrations are forward-only.
Do not manually edit `schema_migrations` or attempt a down migration. If new code and data
must be rolled back together, restore the pre-upgrade complete backup.

## 7. Monitoring

Use three layers:

1. Compose health: Web HTTP reachability and worker process/data-volume access.
2. Administrator task and health pages: queue/running state, lease expiry, safe failures,
   disk use, read/search percentiles and worker health.
3. Host monitoring: free filesystem space, RAM pressure, container restarts and backup age.

The authenticated `GET /api/manage/health` response includes active leases, in-process
metrics, WAL bytes and the latest worker checkpoint record. It is private, non-cacheable and
must not be published as an anonymous health endpoint.

The worker runs a PASSIVE WAL checkpoint about once per minute. Investigate
`WAL_CHECKPOINT_BUSY` or a WAL at/above 256 MiB; do not run a forceful checkpoint while Web
or worker is active. Logs contain opaque IDs and safe error codes. Do not paste credentials,
cookies, raw ZIP paths or private document content into incident tickets.

## 8. Quarantine and retention

Startup reconciliation inventories staging, database rows and immutable versions.
Unreferenced complete version directories move to per-book quarantine; old quarantine
entries are removed only after 24 hours. Retention always preserves the current and newest
previous verified version. Failed path deletion remains visible for a later retry.

Do not manually move quarantine entries into `versions`, delete the current version, remove
the previous verified version, or delete FTS rows. Preserve the volume and follow
`recovery.md` if reconciliation reports a corrupt current version.
