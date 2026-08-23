# Tasks: Naming, Import, and Path Closure

**Input**: Design documents from `/specs/014-naming-import-path-closure/`

**Prerequisites**: D-124, spec.md, plan.md, research.md, data-model.md, contracts/ and checklists/

**Tests**: Architecture, parser clean-switch, hostile archive/path, storage cleanup, publication,
worker, authorization/cache, browser, reference exactness and performance evidence are mandatory.

## Phase 1: Setup And Governance

**Purpose**: Freeze the approved naming, import, path and evidence rules before source changes.

- [x] T001 Record D-124 in `docs/decisions/decision-log.md` and activate feature 014 in `.specify/feature.json`.
- [x] T002 Create and validate all feature 014 specification, plan, research, data model, contracts, quickstart and requirement checklists in `specs/014-naming-import-path-closure/`.
- [x] T003 Audit current alias/local import counts, `V2`/legacy identifiers, vague files and path consumers and record the baseline in `specs/014-naming-import-path-closure/evidence.md`.
- [x] T004 Commit the completed feature 013 architecture closure and its `specs/013-architecture-closure/evidence.md` separately before feature 014 source changes.

---

## Phase 2: Foundational Evidence

**Purpose**: Add failing gates for canonical imports, semantic names and path failures before implementation.

- [x] T005 [P] Add accepted local-relative and rejected local-alias/cross-package-relative fixtures under `tests/fixtures/architecture/` and assertions in `tests/architecture/dependency-graph.test.ts`.
- [x] T006 [P] Add semantic identifier and filename rule tests in `tests/architecture/semantic-names.test.ts` covering current APIs and allowed persisted/version literals.
- [x] T007 [P] Add non-TSV native PDF output rejection evidence in `tests/unit/compiler/pdf-contents-evidence.test.ts`.
- [x] T008 [P] Add canonical POSIX internal-path and symlink-root/managed-directory cases in `tests/integration/storage/filesystem.test.ts`.
- [x] T009 [P] Add archive control, drive-relative, Unicode/case-fold collision and prefix-bound cases in `tests/integration/archive/path-security.test.ts`.
- [x] T010 [P] Add second-pass ZIP identity mismatch and complete extraction cleanup evidence in `tests/integration/archive/extraction.test.ts`.
- [x] T011 Add atomic replacement rename-failure cleanup and prior-target preservation evidence in `tests/integration/storage/filesystem.test.ts`.

**Checkpoint**: New tests fail for missing canonical import, semantic naming and path behavior while existing suites remain green.

---

## Phase 3: User Story 1 - Understand Code From Its Local Context (Priority: P1)

**Goal**: Local dependencies are short and obvious; cross-package/module edges and public APIs remain explicit and semantically named.

**Independent Test**: Canonicalization reports zero replacements, architecture reports zero diagnostics, and no vague module facade or handler contract remains.

- [x] T012 [US1] Define ownership-package and canonical-specifier functions, including `src-root` and the reserved schema alias, in `scripts/architecture/boundaries.ts` until T005 local/cross-package cases pass.
- [x] T013 [US1] Change `scripts/architecture/canonical-imports.ts` to emit relative package-local specifiers and root-alias cross-package specifiers for imports, exports, import types and dynamic imports while leaving tests/scripts and `@/schemas/*` outside rewriting.
- [x] T014 [US1] Update `scripts/architecture/dependency-graph.ts` to accept canonical local relatives, reject noncanonical spellings and preserve resolved layering/coupling/cycle checks.
- [x] T015 [P] [US1] Rename `src/modules/catalog/application/public.ts` to `catalog-api.ts` and update Catalog consumers without a forwarding file.
- [x] T016 [P] [US1] Rename `src/modules/identity/application/public.ts` to `identity-api.ts` and update Identity consumers and `src/env.d.ts` without a forwarding file.
- [x] T017 [US1] Rename `src/modules/publishing/application/public.ts` to `publishing-api.ts` and update Publishing, worker, Web and test consumers without a forwarding file.
- [x] T018 [P] [US1] Rename `src/modules/reader/application/public.ts` to `reader-api.ts` and update Reader, Web, style and test consumers without a forwarding file.
- [x] T019 [US1] Rename `src/composition/worker-child/types.ts` to `job-handler.ts`, preserve its narrow handler contract and update registry/handler consumers.
- [x] T020 [US1] Canonicalize all first-party imports under `src/` with `scripts/architecture/canonical-imports.ts --write` and manually resolve any ambiguous or self-facade imports.
- [x] T021 [US1] Update architecture fixtures and expected cross-module API paths under `tests/fixtures/architecture/` for named facades.
- [x] T022 [US1] Run architecture import/check/test gates and record import counts, named facade paths and zero diagnostics in `specs/014-naming-import-path-closure/evidence.md`.

**Checkpoint**: Every product import uses the target-aware form and all module/layer boundaries remain enforced.

---

## Phase 4: User Story 2 - Keep One Current Runtime Path (Priority: P1)

**Goal**: Runtime types and operations describe current concepts while strict data versions remain explicit and only one parser path exists.

**Independent Test**: Semantic-name checks pass, stored identity fixtures remain unchanged, non-TSV PDF data no longer enters an old parser, and current supported fixtures still pass.

- [x] T023 [P] [US2] Rename `PrintedContentsAnalysisV2` and its create/parse APIs in `src/modules/publishing/core/preparation/printed-contents-analysis.ts` and update all product/test callers while retaining the strict identity literal.
- [x] T024 [P] [US2] Rename `scripts/fixtures/mineru-reference-v2.ts` and `tests/unit/fixtures/mineru-reference-v2.test.ts` to semantic filenames and rename current reference types/functions across scripts/tests while retaining schema version 2 data.
- [x] T025 [US2] Remove `legacyNativeRecords()` and the dual-format native parsing branch from `src/modules/publishing/adapters/filesystem/read-pdf-contents-evidence.ts` so malformed non-TSV output follows current diagnostics/OCR policy.
- [x] T026 [US2] Implement the first-party semantic name scanner in `scripts/architecture/semantic-names.ts`, wire it into `package.json`, and make T006 pass without scanning string-literal schema/identity values.
- [x] T027 [US2] Search product and fixture-tool source for stale old exports, forwarding files, `V<number>` identifiers and `legacy` implementations; remove every unapproved result and record approved literal exceptions in `specs/014-naming-import-path-closure/evidence.md`.
- [x] T028 [US2] Run printed-contents, PDF evidence, reference authoring/comparison and semantic-name tests and record strict version compatibility in `specs/014-naming-import-path-closure/evidence.md`.

**Checkpoint**: One semantically named runtime path consumes each strict current representation.

---

## Phase 5: User Story 3 - Keep Directory Work Inside Its Boundary (Priority: P1)

**Goal**: Internal and archive paths have deterministic bounded identities, and filesystem failure cannot escape or leave ambiguous temporary state.

**Independent Test**: Hostile path, symlink, changed ZIP, extraction cleanup and atomic-write failure fixtures pass with no unexpected files.

- [x] T029 [US3] Move `StorageLayout` and `createStorageLayout()` from `src/platform/filesystem/layout.ts` to `storage-layout.ts`, canonicalize the root, reject root/managed symlinks and return only same-device canonical directories.
- [x] T030 [P] [US3] Move canonical relative-path resolution to `src/platform/filesystem/contained-path.ts`, reject noncanonical POSIX components and update focused tests.
- [x] T031 [P] [US3] Move exclusive creation and atomic replacement to `src/platform/filesystem/atomic-file.ts`, close/remove temporary siblings on pre-rename failure and update focused tests.
- [x] T032 [US3] Update all product/test imports from deleted `src/platform/filesystem/layout.ts` directly to the three semantic filesystem primitives without a forwarding file.
- [x] T033 [US3] Extend `src/modules/publishing/core/preparation/archive-path-policy.ts` with control/drive-relative rejection and case-fold collision keys while preserving strict UTF-8, NFC, byte and depth limits.
- [x] T034 [US3] Replace the archive registry descendant scan with bounded prefix-map checks in `src/modules/publishing/core/preparation/archive-path-policy.ts`, preserving valid explicit-after-implicit directories.
- [x] T035 [US3] Extend `InspectedArchiveEntry` identity comparison in `src/modules/publishing/adapters/filesystem/inspect-zip.ts` and `extract-archive.ts` before creating each second-pass target.
- [x] T036 [US3] Audit `src/modules/publishing/adapters/filesystem/resolve-document-resources.ts`, source snapshots, draft artifacts, candidate inventory and Reader file adapters against the canonical path contract and remove duplicate/ad-hoc containment where the platform primitive applies.
- [x] T037 [US3] Audit sealed extraction, permanent removal, reclaim and reconciliation paths for symlink, containment, cleanup and rename boundaries; add any discovered focused evidence in `tests/integration/storage/` or `tests/integration/recovery/`.
- [x] T038 [US3] Run archive, filesystem, import, source snapshot, resource, publication recovery and permanent-deletion suites and record results plus residual same-UID race limits in `specs/014-naming-import-path-closure/evidence.md`.

**Checkpoint**: Accepted paths have one identity, hostile names reject before writes, and failures clean only the intended tree.

---

## Phase 6: User Story 4 - Verify The Real Application With The Browser Plugin (Priority: P2)

**Goal**: Library, management, publishing, preview and reader workflows remain usable in the available in-app Browser surface.

**Independent Test**: The Browser plugin completes the desktop journeys and one mobile pass with no blocking visible, console, network, asset or overlap failure.

- [x] T039 [US4] Build the updated application and start isolated Web/worker processes on a free localhost port without stopping the existing port 4321 preview; record the URL in `specs/014-naming-import-path-closure/evidence.md`.
- [x] T040 [US4] Use the in-app Browser to inspect `/library`, `/manage`, `/manage/tasks`, a publishing workbench, preview and published Reader/TOC journey including console/network state.
- [x] T041 [US4] Use the in-app Browser to inspect task content density, recovery actions, publishing structure/preview switching and Reader drawer/search/navigation interaction, recording results in `specs/014-naming-import-path-closure/evidence.md`.
- [x] T042 [US4] Run mobile-width library, task, management/publishing and Reader passes in the Browser plugin, inspect for clipped/overlapping/blank/unreachable UI, and record it in `specs/014-naming-import-path-closure/evidence.md`.
- [x] T043 [US4] Record route, viewport, interaction, console/network and screenshot evidence for the available Browser surface and fix every observed regression before continuing.

**Checkpoint**: The Browser plugin establishes real route, content and interaction continuity after the refactor.

---

## Phase 7: Validation And Convergence

**Purpose**: Complete repository gates, commit coherent batches and synchronize every artifact.

- [x] T044 Run Prettier on changed files followed by `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build`; record exact counts/results in `specs/014-naming-import-path-closure/evidence.md`.
- [x] T045 Run `pnpm test:e2e` and the worker recovery/concurrency suites, preserving one claimed task, four-page backpressure, leases, timeout, retry, health, RSS and stage observation.
- [x] T046 Run authorization, private-resource 404, cache/indexing, publication crash, rollback, orphan recovery and immutable-version suites under `tests/integration/auth/`, `tests/integration/http/`, `tests/integration/publication/` and `tests/integration/recovery/`.
- [x] T047 Run all fifteen registered reference comparisons and the synthetic stress/representative performance gates; record exactness and wall/RSS/read/search results in `specs/014-naming-import-path-closure/evidence.md`.
- [x] T048 Synchronize import, named application API and filesystem rules in `docs/architecture/m1-architecture.md` plus any affected operations documentation.
- [x] T049 Re-evaluate every item in `specs/014-naming-import-path-closure/checklists/architecture-path.md` and `requirements.md` against final artifacts.
- [x] T050 Run Spec Kit analyze with no unmitigated CRITICAL finding, run converge, append any remaining work to `specs/014-naming-import-path-closure/tasks.md` and implement every appended task.
- [x] T051 Commit feature 014 in coherent governance, naming/import, path-hardening and verification batches and leave `git status` clean.

---

## Phase 8: Browser Follow-Up

- [x] T052 [US4] Bound completed task history and preserve active/actionable recovery work in `src/web/components/import/TaskMonitor.tsx` after Browser evidence found 35 full cards and a 10,522 px default page.
- [x] T053 [US4] Add task grouping/history coverage in `tests/unit/components/task-monitor.test.tsx` and refresh-aware management/worker assertions in `tests/e2e/manage-shell.spec.ts` and `tests/e2e/worker-recovery.spec.ts`.
- [x] T054 [US4] Re-run Browser desktop/mobile task, workbench, preview, Reader drawer and search interactions and record the fixed card counts, dimensions and console state in `specs/014-naming-import-path-closure/evidence.md`.
- [x] T055 Commit the Browser follow-up as a separate verified batch and leave `git status` clean.

---

## Dependencies And Execution Order

- Phase 1 precedes source changes; Phase 2 tests precede corresponding implementation.
- US1 establishes canonical imports and named module APIs before US2 removes versioned runtime names.
- US2 removes the obsolete parser before US3 reorganizes shared filesystem imports and path behavior.
- US3 must pass before browser/server startup; US4 depends on the built integrated application.
- All stories precede full correctness/performance validation and convergence.

## Parallel Opportunities

- T005–T010 target independent architecture, compiler, storage and archive test areas.
- T015, T016 and T018 rename independent business module APIs after architecture rules exist; Publishing
  T017 remains sequential because it has the broadest caller set.
- T023 and T024 affect independent runtime and offline reference concepts.
- T030 and T031 split independent path and atomic-file primitives after T029 establishes the layout API.
- Automated full-suite, reference and benchmark commands may run concurrently only when they do not
  compete for the same worker/database/fixture resources; Browser journeys remain sequential so
  screenshots and console evidence stay attributable.

## Implementation Strategy

The first usable increment is US1: code locality becomes readable while all architecture boundaries
remain enforced. US2 removes historical naming and the last old parser rather than retaining aliases.
US3 strengthens the filesystem boundary with failing evidence first. US4 then proves that broad file
moves did not break user workflows. Each completed source phase receives its own commit; no temporary
compatibility layer crosses a commit boundary.
