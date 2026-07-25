# Implementation Plan: Local Docker Preview

**Branch**: `[002-local-docker-preview]` | **Date**: 2026-07-25 | **Spec**:
[spec.md](./spec.md)

**Input**: Feature specification from
`/specs/002-local-docker-preview/spec.md`

## Summary

Provide a repository-local launcher that layers a localhost-only Compose override onto the
existing hardened production definition. One command builds the existing image, creates a
private local configuration and named volume, applies migrations, invokes the established
offline administrator bootstrap when needed, and starts exactly one Web and one worker.
Subsequent status, logs and stop actions preserve the volume.

## Technical Context

**Language/Version**: Bash on Linux; Docker Compose specification; TypeScript 6 contract
tests on Node.js 24

**Primary Dependencies**: Docker Engine, Docker Compose plugin, the repository-pinned Node
24 image and existing Mirawind production image

**Storage**: Git-ignored `.env` with mode `0600`; one project-scoped Docker named volume
using the existing SQLite WAL and book-storage layout; no schema change

**Testing**: `bash -n`, Compose merged-configuration validation, Vitest contract tests,
real image build, migrations, container health checks and loopback HTTP probe

**Target Platform**: Single Linux Docker host; localhost browser

**Project Type**: Operational CLI wrapper and Compose configuration for the existing Web
application

**Performance Goals**: Once images are available, a previously initialized project reaches
healthy Web and worker states within two minutes

**Constraints**: Bind only `127.0.0.1:4321`; exactly one Web and one worker; no password or
secret logging; first bootstrap requires a TTY; stop preserves the volume; production
Compose/Caddy behavior remains unchanged

**Scale/Scope**: One administrator, one local Compose project, one named volume and the
existing single-host M1 application

## Constitution Check

_GATE: Passed before Phase 0 research and passed again after Phase 1 design._

- **Authority & schemas — PASS**: The existing Markdown, `book.yaml`, immutable versions
  and SQLite schema remain authoritative. Local configuration contains only runtime
  settings and a secret. No schema or migration is added.
- **Atomicity & recovery — PASS**: The launcher delegates to existing checksummed migrations,
  persistent volume and Web/worker recovery behavior. Failed setup does not report ready;
  rerunning resumes from durable initialized state.
- **Security boundary — PASS**: Web binds only to loopback. A high-entropy secret is stored
  in a Git-ignored `0600` file and never printed. Administrator credentials remain in the
  existing hidden TTY bootstrap. Production hardening is inherited, not rewritten.
- **Request-path budget — PASS**: The worker remains separate and owns compilation. The
  launcher introduces no reader-request work.
- **Evidence — PASS**: Contract tests cover merged configuration and secret/password
  boundaries. A real Docker run covers build, migrations, both health checks and the
  localhost login page.
- **Simplicity — PASS**: A small override and shell entry point reuse the existing image and
  Compose definition. No supervisor, new service, database or queue is introduced.

## Project Structure

### Documentation

```text
specs/002-local-docker-preview/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── local-launcher.md
├── checklists/
│   ├── requirements.md
│   └── deployment.md
└── tasks.md
```

### Source Code

```text
docker/
├── Dockerfile
├── compose.yaml
├── compose.local.yaml
└── local.sh

tests/contract/
├── container-hardening.test.ts
└── local-container.contract.test.ts

README.md
docs/
├── architecture/m1-architecture.md
├── operations/deployment.md
└── product/product-spec.md
```

**Structure Decision**: Keep production files authoritative and add only a local override
plus launcher. Test the local contract alongside the existing production hardening contract.

## Complexity Tracking

No constitution violation or extra architecture layer is introduced.
