# Tasks: Local Docker Preview

**Input**: Design documents from `/specs/002-local-docker-preview/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Contract and real-container evidence are mandatory because the launcher touches
authentication setup, migrations, process isolation and persistent storage.

**Organization**: Tasks are grouped by independently testable user story.

## Phase 1: Setup

**Purpose**: Freeze the approved local-preview boundary before implementation.

- [x] T001 Record D-098 and create the feature specification, plan, research, data model, launcher contract, Quickstart and requirements checklists in `docs/decisions/decision-log.md` and `specs/002-local-docker-preview/`

---

## Phase 2: Foundational evidence

**Purpose**: Establish a failing contract for the shared launcher and merged Compose
configuration.

- [x] T002 Add contract evidence for separate Web/worker processes, loopback publication, local configuration, interactive bootstrap, secret exclusion and production isolation in `tests/contract/local-container.contract.test.ts`

---

## Phase 3: User Story 1 - Start a fresh local library (Priority: P1) 🎯 MVP

**Goal**: One command prepares configuration, storage, migrations, administrator and healthy
processes.

**Independent Test**: Run the launcher against a new project, answer the offline bootstrap
prompts and open the reported localhost login page.

- [x] T003 [US1] Add the localhost-only Web/worker environment and local-proxy exclusion in `docker/compose.local.yaml`
- [x] T004 [US1] Implement Docker-only secret generation, ownership initialization, migrations, administrator-state detection, interactive bootstrap and health-gated startup in `docker/local.sh`

---

## Phase 4: User Story 2 - Resume and inspect an existing local library (Priority: P2)

**Goal**: Restart and operate the local project without losing durable state.

**Independent Test**: Stop and restart an initialized project, then inspect healthy process
state and confirm bootstrap is skipped.

- [x] T005 [US2] Implement repeat-start administrator detection plus status and bounded log-following actions in `docker/local.sh`
- [x] T006 [US2] Implement worker-first stop with persistent-volume retention in `docker/local.sh`

---

## Phase 5: User Story 3 - Keep local preview isolated from production (Priority: P3)

**Goal**: Local HTTP convenience cannot alter the production HTTPS topology or listen beyond
loopback.

**Independent Test**: Resolve the merged local Compose configuration and run both local and
production container contracts.

- [x] T007 [US3] Extend the local contract to cover the exact loopback listener, disabled local Caddy, unchanged production hardening and absence of password variables in `tests/contract/local-container.contract.test.ts`
- [x] T008 [US3] Validate the merged production/local Compose model while retaining the authoritative production files in `docker/compose.yaml`, `docker/Caddyfile`, and `docker/compose.local.yaml`

---

## Phase 6: Polish and release evidence

**Purpose**: Make the launcher discoverable and prove the real container path.

- [x] T009 [P] Document one-command first start, login, status, logs, stop and production boundaries in `README.md` and `docs/operations/deployment.md`
- [x] T010 Synchronize D-098 into the current product specification, architecture and M1 audit/provenance documentation in `docs/product/product-spec.md`, `docs/architecture/m1-architecture.md`, and `docs/audits/`
- [x] T011 Run `bash -n`, formatting, lint, typecheck, contract tests, Compose config validation, real image build, migrations, Web/worker health checks and localhost login probe, then record the results in `specs/002-local-docker-preview/quickstart.md`
- [x] T012 Perform final Spec Kit analysis and convergence with no unmitigated CRITICAL finding, update the feature lifecycle status, and leave every task complete in `specs/002-local-docker-preview/`

---

## Dependencies and execution order

- Phase 1 precedes all implementation.
- Phase 2 contract evidence precedes launcher and override implementation.
- User Story 1 is the MVP and blocks real validation of User Story 2.
- User Story 2 and User Story 3 touch different behavioral concerns but share launcher and
  contract files, so their tasks run sequentially.
- Phase 6 follows all three stories.

## Implementation strategy

1. Freeze D-098 and specification artifacts.
2. Establish the local deployment contract.
3. Deliver first-start behavior.
4. Add restart/inspection/stop behavior.
5. Prove loopback and production isolation.
6. Run the real Docker Quickstart, synchronize documentation and converge.
