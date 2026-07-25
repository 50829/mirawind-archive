# Quickstart: Local Docker Preview

## First start

From the repository root on a Linux Docker host:

```bash
./docker/local.sh
```

Enter the administrator email, display name and 16–128-character fallback password only
when the offline prompt appears.

Expected:

- private `.env` exists with mode `0600`;
- migrations are current;
- Web and worker report healthy;
- <http://localhost:4321/login> opens;
- no host interface other than loopback publishes port 4321.

## Resume and inspect

```bash
./docker/local.sh status
./docker/local.sh logs
./docker/local.sh stop
./docker/local.sh
```

The administrator and library remain available after restart.

## Contract validation

```bash
bash -n docker/local.sh
pnpm test:contract
docker compose \
  --project-name mirawind-local \
  --env-file .env \
  --file docker/compose.yaml \
  --file docker/compose.local.yaml \
  config --quiet
```

The production container-hardening contract and local-launcher contract must both pass.

## Validation record

Validated on 2026-07-25 with Docker Engine 29.6.2 and Docker Compose v5.3.1:

- `bash -n docker/local.sh`, repository formatting, ESLint and Astro/TypeScript checks
  exited zero;
- all 9 contract files and 35 contract tests passed, including production hardening and the
  local launcher;
- the production Compose definition and merged local override both resolved successfully;
- the pinned image built, the Docker-only generator produced a 64-character secret without
  printing it, and `.env` retained mode `0600`;
- ownership initialization and migration completed at schema 5;
- direct `./docker/local.sh` restart reused the durable administrator pointer, stopped
  worker before Web, migrated, and reached healthy Web and worker states in 59 seconds;
- the login probe returned HTTP 200, the only published listener was
  `127.0.0.1:4321`, and no local Caddy container ran;
- `stop` stopped worker before Web and retained `mirawind-local_mirawind-data`; the
  subsequent direct launcher start succeeded with the same volume.

Fresh administrator bootstrap remains deliberately interactive. Run the first command in
the administrator's private terminal and never paste the fallback password into chat,
environment variables or command arguments.
