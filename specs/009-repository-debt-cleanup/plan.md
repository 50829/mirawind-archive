# Implementation Plan: Repository Debt Cleanup

**Branch**: `009-repository-debt-cleanup` | **Date**: 2026-07-31 | **Spec**:
[spec.md](./spec.md)

**Input**: Feature specification from `specs/009-repository-debt-cleanup/spec.md`

## Summary

Replace the hidden SQL coupling around permanent deletion, background jobs and version
presentations with narrow application operations and one composition-owned transaction boundary.
Clean-switch the single database baseline and worker protocol to distinct internal
`reclaim_versions` and `purge_book` jobs, make `jobs.book_id` the authoritative scope as soon as a
book is known, and reduce the generic job repository to queue/lease/progress/task-row behavior.
Replace partial test schemas with the production baseline, remove confirmed dead code and stale
generated output, and retain current HTTP behavior, content correctness and representative build
performance.

## Technical Context

**Language/Version**: TypeScript 6.0.3 on Node.js 24.x

**Primary Dependencies**: Astro 7.1.3, React 19.2.8, better-sqlite3 12.11.1, existing worker child
protocol and local filesystem adapters

**Storage**: SQLite WAL plus private local filesystem; one clean-switch `0001` baseline

**Testing**: Vitest unit/contract/integration/architecture, Playwright E2E, existing real-fixture
reference and production-pipeline benchmark scripts

**Target Platform**: One Linux host with one Astro Web process and one same-codebase worker

**Project Type**: Server-rendered web application with a durable background publishing pipeline

**Performance Goals**: Keep all fifteen reference comparisons exact; keep three representative
production book builds within `max(5%, 1 s)` of the accepted current results; add no reader/search
request-path work

**Constraints**: Preserve immutable publication and hostile-input boundaries; no old baseline or job
compatibility; no new service/database/queue; no speculative ports or absence-only tests; product
source imports remain canonical `@/`

**Scale/Scope**: Approximately 235 product source files, six current job kinds, one permanent deletion
lifecycle, fifteen registered real MinerU references, and about 11 GiB of ignored reproducible local
output eligible for cleanup

## Constitution Check

_GATE: Passed before research and re-checked after design._

- **Authority & schemas**: Markdown and `book.yaml` remain unchanged authorities. Jobs, deletion
  tombstones and presentations remain server lifecycle/derived data. D-119 records an owner-approved
  clean switch of the single baseline and worker protocol; unsupported existing ledgers are rejected
  without mutation by the existing baseline loader. No content format version changes.
- **Atomicity & recovery**: Filesystem removal remains idempotent and precedes the final database
  purge. Accept, terminal failure/interruption, retry and final purge each have one immediate
  transaction spanning the Catalog deletion store, Publishing cleanup adapter and task row. Current
  published pointers and candidate registration atomicity remain unchanged.
- **Security boundary**: No new response class or imported representation is introduced. Existing
  administrator authorization, hidden 404, private no-store task APIs, safe error codes, explicit
  removal roots and hostile archive limits remain unchanged. Ports carry opaque IDs/counts only.
- **Request-path budget**: Work changes only management mutations, worker dispatch and maintenance
  persistence. Reader and search queries retain their current read models and receive no new work.
- **Evidence**: Reuse existing deletion, recovery, candidate, publication, schema, authorization and
  architecture tests. Add only the missing atomic deletion outcome assertions. Run 15/15 reference
  exact and three representative production builds because content algorithms are untouched.
- **Simplicity**: No new deployable unit, infrastructure or general-purpose framework. Two narrow
  mutation ports replace repeated cross-module SQL; a new global task module and cascade-heavy schema
  were rejected as broader than the proven debt.

Post-design check: passed. The design keeps all constitutional deployment, authority, security,
request-path and evidence constraints without an exception.

## Design

### 1. Direct baseline and protocol switch

- Update the only `0001_clean_slate.sql` and baseline identity once.
- Replace internal `reclaim` with `reclaim_versions` and `purge_book` in schema, job phases,
  discriminated worker commands, registry and handlers.
- Preserve existing management API values by a pure mapping:
  `reclaim_versions -> reclaim`, `purge_book -> permanent_book_deletion`. Serialization must not
  query `book_deletions`.
- Require `book_id` on every book-bound job. Import analysis may begin unbound; assigning its import
  to a book updates all jobs for that import in the same transaction.
- Reinitialize local test data after the switch. Do not add a migration, compatibility parser,
  fallback or old-schema test.

### 2. Separate generic task persistence from subject lifecycles

- Keep `JobRepository` responsible for task create/read, idempotency, claim, heartbeat, cancellation
  request, task-row terminal state and a transaction-compatible primitive for a new retry attempt.
- Move candidate terminalization and candidate retry identity creation to the Publishing candidate
  use case/repository.
- Move deletion task enqueue, terminalization and retry association to the Catalog deletion use case.
- Coordinate task row plus subject row updates through narrow ports in one application transaction;
  do not let `JobRepository` query candidates, books or deletion tombstones.
- Keep automatic lease recovery behavior, but dispatch retry by explicit job kind so a candidate or
  deletion retry cannot be created by a generic copy operation.

### 3. Give deletion SQL one owner per table family

- Catalog owns `books`, `book_deletions`, deletion confirmation/token behavior and the retained
  tombstone.
- Publishing owns cancellation/scrubbing/purge of `jobs`, `draft_candidates`, `imports`,
  `source_snapshots`, `config_revisions`, `book_versions`, originals and search data.
- Catalog's deletion use cases consume one `BookPublishingCleanupPort` for cancel, inventory and final
  Publishing purge; its SQLite implementation stays in Publishing adapters.
- Composition wires the Catalog store, Publishing cleanup adapter, filesystem remover and shared
  immediate transaction. No adapter imports another module's concrete adapter.
- Replace the repeated relationship closure with `jobs.book_id`; final cleanup may detach retained
  operational rows only after all subject-owned rows are terminal.
- Preserve intentional Catalog/Reader read-only joins used for library, details, search and published
  reading models.

### 4. Use one presentation writer

- Add the current `BookVersionPresentationWriter` operation to the Catalog application surface.
- Keep `BookPresentationRepository` as the only SQL insert implementation.
- Inject that writer into candidate registration; remove presentation SQL from `VersionRepository`.
- Reconciliation and recovery reuse the same repository. Version/search/candidate/job registration
  remains in one outer transaction.

### 5. Delete only evidence-backed residue

- Convert the three job recovery/lease tests to the complete migrated test database and a second
  connection to the same file; delete `createJobRepositorySchema`, `hasTable` and all missing-table
  branches.
- Delete the unused Publishing audit repository and unused SQLite capabilities forwarding file.
- Make internal-only exported errors/constants/functions private where no consumer exists; retain
  framework route exports and real test/runtime hooks.
- Do not split `printed-contents`, `structure-proposal`, PDF evidence, UI components or composition
  files solely by line count. Their behavior is outside this cleanup unless a changed responsibility
  requires a local extraction.
- Remove ignored `.cache/`, `test-results/`, generated build output and test reports after accepted
  evidence has been summarized in tracked files. Explicitly exclude `.env`, real MinerU/EPUB fixtures
  and the user's three untracked research documents.

## Project Structure

### Documentation (this feature)

```text
specs/009-repository-debt-cleanup/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── job-and-http-status.md
│   └── cleanup-boundary.md
├── checklists/
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── modules/
│   ├── catalog/
│   │   ├── application/
│   │   │   ├── commands/                  # accept/retry/finalize deletion use cases
│   │   │   ├── ports/                     # narrow Publishing cleanup and transaction ports
│   │   │   └── public.ts
│   │   └── adapters/
│   │       ├── filesystem/                # exact book/upload/staging removal
│   │       └── sqlite/                    # books, deletion tombstones, sole presentation writer
│   └── publishing/
│       ├── application/
│       │   ├── commands/                  # task completion/retry dispatch and candidate lifecycle
│       │   ├── ports/
│       │   └── public.ts
│       └── adapters/
│           ├── sqlite/
│           │   ├── jobs.ts                # generic queue/lease/progress/task rows only
│           │   └── book-cleanup.ts        # Publishing-owned purge implementation
│           └── worker/
├── entrypoints/worker/                     # closed discriminated commands and registry
├── composition/                            # concrete adapter wiring and shared transaction
└── platform/                               # unchanged business-neutral SQLite/filesystem primitives

tests/
├── contract/                               # current API/protocol shape
├── integration/
│   ├── deletion/                           # atomic deletion lifecycle behavior
│   ├── publication/                        # one presentation writer through behavior
│   └── recovery/                           # full baseline task persistence and leases
└── architecture/                           # existing dependency checks only
```

**Structure Decision**: Keep the D-117 business-module layout. Put consumer-facing cleanup ports and
deletion orchestration in Catalog application, implement only Publishing-owned data removal inside
Publishing adapters, and wire both in composition. No global `tasking`, `services` or `utils` layer is
introduced.

## Commit Strategy

1. `docs(architecture): define maintenance ownership cleanup`
2. `test(worker): use the complete job schema`
3. `refactor(worker)!: split maintenance job identities`
4. `refactor(catalog): isolate book cleanup ownership`
5. `refactor(publishing): unify presentation persistence`
6. `chore: remove confirmed repository residue`
7. `docs(architecture): close repository debt cleanup`

Each source commit must leave focused tests, typecheck and architecture checks passing. The baseline
switch commit is intentionally breaking for test-stage databases and uses a `BREAKING CHANGE:` footer.

## Complexity Tracking

No constitution violation or additional infrastructure is required.
