# Feature Specification: Local Docker Preview

**Feature Branch**: `[002-local-docker-preview]`

**Created**: 2026-07-25

**Status**: Implemented and verified

**Input**: Let an administrator start and inspect Mirawind locally through one Docker
command without manually coordinating the Web and worker processes.

## User Scenarios & Testing

### User Story 1 - Start a fresh local library (Priority: P1)

As the administrator, I run one command from the repository and receive a working local
Mirawind login page without preparing runtime configuration, migrations or processes by
hand.

**Why this priority**: A first-time user cannot inspect the product until configuration,
storage, schema and the sole administrator all exist.

**Independent Test**: On a Docker host with no prior local Mirawind project, run the launcher,
complete the interactive administrator prompts, and open the reported login URL.

**Acceptance Scenarios**:

1. **Given** no local configuration or data volume exists, **When** the administrator runs
   the launcher in an interactive terminal, **Then** it creates private configuration,
   initializes persistent storage, applies every migration, prompts for administrator
   details and starts a healthy local library.
2. **Given** no administrator exists and input is non-interactive, **When** the launcher
   reaches bootstrap, **Then** it exits with a clear error and does not accept a password
   through an environment variable or command argument.
3. **Given** startup succeeds, **When** the administrator opens the reported localhost URL,
   **Then** the login page is available and background work can be handled by the worker.

---

### User Story 2 - Resume and inspect an existing local library (Priority: P2)

As the administrator, I can restart, inspect logs and stop the local library without losing
my account, imported books or published versions.

**Why this priority**: A preview environment is only useful when its state survives ordinary
development sessions.

**Independent Test**: Create an administrator, stop the local project, start it again and
confirm the same account and persistent data remain available.

**Acceptance Scenarios**:

1. **Given** an initialized local library, **When** the administrator runs the launcher
   again, **Then** completed initialization is reused and no second administrator is
   created.
2. **Given** the project is running, **When** the administrator requests status or logs,
   **Then** the Web and worker states can be inspected without exposing credentials.
3. **Given** the project is running, **When** the administrator stops it, **Then** worker
   shutdown precedes Web shutdown and the persistent library remains intact.

---

### User Story 3 - Keep local preview isolated from production (Priority: P3)

As the administrator, I can use a convenient local HTTP preview without weakening the
production HTTPS deployment or accidentally exposing the preview to the network.

**Why this priority**: Developer convenience must not create an alternate insecure
production topology.

**Independent Test**: Resolve the combined local configuration and verify that only the
loopback Web port is published, exactly one Web and one worker remain, and the production
proxy configuration is unchanged.

**Acceptance Scenarios**:

1. **Given** the local project is running, **When** another host attempts to connect,
   **Then** no local preview port is exposed on an external interface.
2. **Given** the production deployment files, **When** the local override is absent,
   **Then** the existing HTTPS proxy, process isolation and hardening remain unchanged.

### Edge Cases

- Docker or its daemon is unavailable.
- The generated configuration exists but its authentication secret is missing, too short or
  still the documented placeholder.
- The local port is already occupied.
- Image build, storage initialization or migration fails.
- First startup is invoked without an interactive terminal.
- Startup is interrupted after migrations but before administrator creation.
- An administrator already exists when the launcher is run again.
- Web becomes healthy but worker fails its health check.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST provide one local launcher command that coordinates build,
  initialization, migration, administrator setup and startup.
- **FR-002**: On first use, the launcher MUST create a private high-entropy authentication
  secret without displaying or logging it.
- **FR-003**: The launcher MUST initialize a persistent local data store and apply all
  current database migrations before starting application processes.
- **FR-004**: Initial administrator creation MUST use the existing interactive offline
  bootstrap and MUST reject non-interactive password delivery.
- **FR-005**: Subsequent starts MUST detect an existing administrator, skip bootstrap and
  preserve the existing library.
- **FR-006**: Local runtime MUST retain exactly one Web process and one separate worker
  process with the same persistent storage and durable queue.
- **FR-007**: Local Web access MUST bind only to the host loopback interface and report an
  exact localhost login URL.
- **FR-008**: The launcher MUST provide status, log-following and orderly stop operations;
  ordinary stop MUST retain persistent data.
- **FR-009**: A failed prerequisite, build, migration, bootstrap or health check MUST return
  a non-zero result and MUST NOT report the library as ready.
- **FR-010**: Local-preview configuration MUST NOT replace or weaken the production
  deployment definition.

### Non-Functional Requirements

- **NFR-001**: No password, authentication secret, cookie or private book content may appear
  in launcher output or tracked configuration.
- **NFR-002**: Local startup and stop behavior MUST be covered by deterministic syntax,
  configuration and contract checks.
- **NFR-003**: After images are available, a healthy existing local library SHOULD start
  within two minutes on the supported single-host environment.
- **NFR-004**: Local-preview files MUST introduce no schema change; the existing forward
  migrations and persistent data format remain authoritative.

### Key Entities

- **Local Compose Project**: The isolated set of local Web, worker, one-off initialization
  processes, network and persistent volume.
- **Local Configuration**: Git-ignored host configuration containing the origin, accepted
  hosts and authentication secret, but never an administrator password.
- **Persistent Local Library**: The Docker-managed data volume containing SQLite and book
  storage across stop and restart.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A first-time administrator can reach the local login page with one launcher
  command plus the required interactive administrator answers.
- **SC-002**: A previously initialized library starts without repeating administrator setup
  and reaches healthy Web and worker states within two minutes after images are available.
- **SC-003**: Port inspection shows zero preview listeners on non-loopback host interfaces.
- **SC-004**: An administrator account and imported library remain available after a normal
  stop and restart.
- **SC-005**: All local-launcher syntax, merged-configuration and deployment contract checks
  pass without changing the production deployment checks.

## Assumptions

- The host runs Linux with Docker Engine and the Docker Compose plugin.
- The administrator launches from an interactive terminal on first use.
- `localhost:4321` is available and is only used for local preview.
- Production setup continues to use the separately documented HTTPS deployment.

## Out of Scope

- Combining Web and worker into one process.
- Exposing the local preview to a LAN or the public Internet.
- Automatic password generation, storage or non-interactive administrator creation.
- Destructive reset or implicit deletion of the local persistent volume.
- Replacing the production Caddy/HTTPS deployment.
