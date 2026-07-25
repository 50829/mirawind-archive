# Research: Local Docker Preview

## R-001 — Reuse Compose with an override

**Decision**: Layer a localhost-only Compose file over the production definition and manage
it under a distinct project name.

**Rationale**: This preserves the hardened image, data initialization, migrations, health
checks and separate Web/worker processes. A distinct project name isolates its network and
volume from production.

**Alternatives considered**:

- One container with a shell or process supervisor: rejected because it weakens process
  isolation, shutdown behavior and the frozen single-Web/single-worker topology.
- A second standalone Compose definition: rejected because production hardening and service
  dependencies would drift.

## R-002 — Keep local HTTP strictly on loopback

**Decision**: Use the approved localhost development origin and bind the host port only to
`127.0.0.1`.

**Rationale**: Local Passkey/password flows can be inspected without installing a local CA,
while the preview is unreachable from other hosts.

**Alternatives considered**:

- Run the production Caddy service locally: rejected for the one-command preview because
  trusting its local CA adds host-specific setup.
- Publish on `0.0.0.0`: rejected because a development HTTP origin must not become a LAN or
  public deployment.

## R-003 — Generate configuration without a host language runtime

**Decision**: Generate the authentication secret with the same pinned Node base image used
by the application, then write the root `.env` with mode `0600`.

**Rationale**: Docker Engine and Compose remain the only host prerequisites. Secret
generation is cryptographically strong, pinned and never printed.

**Alternatives considered**:

- Require host OpenSSL or Node.js: rejected because the Docker entry point should work on a
  Docker-only host.
- Use a fixed development secret: rejected because copied or shared defaults create unsafe
  session equivalence.

## R-004 — Detect bootstrap state from authoritative storage

**Decision**: After migrations, query only `installation.admin_user_id` through a short
read-only process in the built image. Invoke the existing offline bootstrap only when it is
empty.

**Rationale**: A marker file could become stale after volume replacement or restoration.
SQLite already owns the sole administrator pointer.

**Alternatives considered**:

- Run bootstrap on every start and ignore its failure: rejected because expected failures
  obscure real setup errors.
- Store a host marker: rejected because it can disagree with the named volume.

## R-005 — Preserve durable local state

**Decision**: `stop` terminates worker first and Web second but retains containers and the
named volume. No reset action is exposed.

**Rationale**: Ordinary preview sessions must not risk deleting books or administrator
credentials. Destructive volume removal remains an explicit manual Docker operation outside
the launcher.
