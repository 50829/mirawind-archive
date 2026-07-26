# Tasks: Clean-slate Publishing and Reading

**Input**: Design documents from `/specs/006-clean-slate-publishing/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Constitution-critical schema, hostile input, authorization, publication,
recovery, caching and performance evidence is mandatory.

## Phase 1: Setup

- [x] T001 Record the clean switch and light/quiet UI decisions in `docs/decisions/decision-log.md`
- [x] T002 [P] Synchronize current product behavior in `docs/product/product-spec.md`
- [x] T003 [P] Add `@tanstack/react-virtual` and `lucide-react` in `package.json`
- [x] T004 Add 006 design artifacts and contracts under `specs/006-clean-slate-publishing/`

---

## Phase 2: Foundational

- [x] T005 Consolidate the current database structure in `src/db/migrations/0001_clean_slate.sql` and `src/db/migration-manifest.ts`
- [x] T006 [P] Freeze strict current formats in `docs/schemas/book.schema.json`, `docs/schemas/document-manifest.schema.json` and `docs/schemas/version.schema.json`
- [x] T007 [P] Update current schema examples and runtime copying in `docs/schemas/examples/book.v3.yaml` and `scripts/copy-runtime-schemas.mjs`
- [x] T008 Remove legacy schema, compiler, renderer and presentation branches from `src/` and `docs/schemas/`
- [x] T009 [P] Add strict baseline/format contract evidence in `tests/contract/` and `tests/integration/storage/migrations.test.ts`
- [x] T010 Preserve permanent-deletion barriers and cleanup behavior in `src/services/book-deletion.ts` and `src/services/permanent-book-cleanup.ts`

---

## Phase 3: User Story 1 - Import With Trustworthy Progress (P1)

**Goal**: Upload one MinerU ZIP with honest transfer/server/background progress, safe
cancellation/retry and workbench readiness only after preview.

**Independent Test**: Run the registered 97-page fixture from upload through current ready
preview.

- [x] T011 [P] [US1] Add upload boundary, cancellation, retry-key and cleanup evidence in `tests/integration/storage/multipart-import.test.ts` and `tests/integration/storage/import-upload.test.ts`
- [x] T012 [P] [US1] Add closed job progress and 250ms throttle evidence in `tests/unit/worker/protocol.test.ts`
- [x] T013 [P] [US1] Add import snapshot contract evidence in `tests/contract/import-preview.contract.test.ts`
- [x] T014 [US1] Implement XHR transfer progress, abort and idempotent network retry in `src/components/import/ImportUploader.tsx`
- [x] T015 [US1] Return import, confirmation, current job and matching preview in one snapshot from `src/pages/api/manage/imports/[importId]/index.ts`
- [x] T016 [US1] Enforce exact streaming ZIP-field limits in `src/http/multipart/import-form.ts` and `src/services/import-upload.ts`
- [x] T017 [US1] Limit only import POST multipart overhead in `docker/Caddyfile`
- [x] T018 [US1] Enforce per-kind phase sets and bounded progress in `src/jobs/state-machine.ts`, `src/worker/protocol.ts` and `src/worker/job-child.ts`
- [x] T019 [US1] Present the five-stage workflow and title-based reimport target in `src/components/import/ImportUploader.tsx`
- [x] T020 [US1] Add browser evidence for monotonic progress, 100% acceptance state, abort and retry in `tests/e2e/import-upload.spec.ts`

---

## Phase 4: User Story 2 - Edit Structure Against The Real Reader (P1)

**Goal**: Edit one selected structure node beside a revision-pinned real reader while
preserving local changes and locating diagnostics.

**Independent Test**: Exercise representative and stress structures, save, edit during
rebuild, force a conflict and locate a diagnostic.

- [x] T021 [P] [US2] Add strict PATCH, ETag conflict and reversible source-region evidence in `tests/integration/publication/config-revisions.test.ts`
- [x] T022 [P] [US2] Add collapse/search and bounded virtualization evidence for 20, 250, 501, 2,000 and 20,000 nodes in `tests/e2e/publishing-workbench.spec.ts`
- [x] T023 [US2] Return only the bounded workbench projection from `src/pages/api/manage/books/[bookId]/draft.ts`
- [x] T024 [US2] Merge block/region PATCH changes into authoritative v3 config in `src/services/config-revisions.ts`
- [x] T025 [US2] Preserve explicit reversible source-region state in `docs/schemas/book.schema.json` and `src/compiler/document/configured-document.ts`
- [x] T026 [US2] Implement searchable, collapsible and virtualized structure selection in `src/components/preview/StructureEditor.tsx`
- [x] T027 [US2] Implement fixed actions, dirty/building/conflict gates and desktop/390px preview in `src/components/preview/PublishingWorkbench.tsx`
- [x] T028 [US2] Implement severity/page diagnostic filtering and block/page/fragment location in `src/components/preview/DiagnosticsPanel.tsx`
- [x] T029 [US2] Implement preview-first mobile mode switching and focus-safe detail surfaces in `src/pages/manage/books/[bookId]/preview.astro`

---

## Phase 5: User Story 3 - Preview And Publish The Same Reader (P1)

**Goal**: Use the same reader model/runtime for isolated preview and publication, and
publish only a matching ready revision.

**Independent Test**: Compare one revision's preview/published output and exercise session,
stale, deletion and publication crash boundaries.

- [x] T030 [P] [US3] Add preview/publication semantic and reader parity evidence in `tests/integration/compiler/preview-publication-parity.test.ts`
- [x] T031 [P] [US3] Add signed preview authorization, logout, expiry, stale and deletion evidence in `tests/integration/auth/preview-resource-authorization.test.ts` and `tests/integration/auth/draft-visibility.test.ts`
- [x] T032 [P] [US3] Add sandbox/CSP/CORS/CORP/cache browser evidence in `tests/e2e/publishing-quality.spec.ts`
- [x] T033 [US3] Define the shared `ReaderPageModel` and `ReaderShell` in `src/components/reader/ReaderShell.tsx`
- [x] T034 [US3] Generate complete ReaderShell preview pages in `src/jobs/handlers/build-preview.ts`
- [x] T035 [US3] Move reader behavior to the versioned external runtime in `src/components/reader/reader-runtime.js` and `scripts/prepare-reader-assets.mjs`
- [x] T036 [US3] Implement typed ready/location/navigate validation in `src/components/preview/PublishingWorkbench.tsx`
- [x] T037 [US3] Implement session/revision/resource-bound preview authorization in `src/http/authorization/preview-resource.ts`
- [x] T038 [US3] Apply preview framing and reader asset response policies in `src/middleware.ts` and `docker/Caddyfile`
- [x] T039 [US3] Keep publish disabled for dirty, stale, building, failed and blocking states in `src/components/preview/PublishPanel.tsx`
- [x] T040 [US3] Preserve atomic publication and crash recovery in `src/services/publication.ts` and `src/jobs/handlers/build-publish.ts`

---

## Phase 6: User Story 4 - Read An Accessible Published Book (P2)

**Goal**: Serve a responsive semantic reader with hierarchical navigation and singular,
accessible formulas.

**Independent Test**: Read representative pages at desktop/mobile sizes, keyboard-only,
enlarged text and high zoom with full KaTeX CSS blocked.

- [x] T041 [P] [US4] Add heading, skip-link, focus, target and local-overflow evidence in `tests/unit/library/reader-interaction.test.ts` and `tests/e2e/publishing-quality.spec.ts`
- [x] T042 [P] [US4] Add formula structure and blocked-stylesheet evidence in `tests/unit/compiler/renderer-assets.test.ts` and `tests/e2e/publishing-quality.spec.ts`
- [x] T043 [US4] Embed minimal MathML visually-hidden critical CSS in `src/compiler/render/assets.ts`
- [x] T044 [US4] Serve reader runtime/CSS and KaTeX CSS/fonts as immutable cross-origin-compatible assets in `src/middleware.ts`
- [x] T045 [US4] Complete responsive reader hierarchy and overflow behavior in `src/styles/reader.css`
- [x] T046 [US4] Run axe, keyboard, 200% text, 400% zoom and 320/360/768/1024/1440 screenshot evidence in `tests/e2e/publishing-quality.spec.ts`

---

## Phase 7: Convergence And Release Evidence

- [x] T047 Remove obsolete uploader, task, preview/editor and page-style implementations, and consolidate management polling in `src/components/` and `src/pages/`
- [x] T048 [P] Run format, lint, typecheck, contract, unit, integration and build commands from `specs/006-clean-slate-publishing/quickstart.md`
- [x] T049 Run the 97-page browser loop and registered 441/583-page compatibility builds using `tests/fixtures/mineru/real/`
- [x] T050 Run the 500-page synthetic build and uncached reading p95 benchmark with `scripts/benchmarks/reference.ts`
- [x] T051 Run Spec Kit analysis and resolve every CRITICAL finding in `specs/006-clean-slate-publishing/`
- [x] T052 Run Spec Kit convergence and append/complete any remaining implementation tasks in `specs/006-clean-slate-publishing/tasks.md`

---

## Dependencies

- Phase 2 depends on Phase 1 and blocks all user stories.
- US1 can complete after Phase 2.
- US2 depends on current preview production from US1.
- US3 depends on current preview production and workbench state from US1/US2.
- US4 shares ReaderShell with US3 and completes after the shared runtime is stable.
- Release evidence depends on all selected user stories.

## Parallel Opportunities

- T002-T003, T006-T007 and evidence tasks marked `[P]` touch separate files.
- Within US1, transport, contract and worker protocol evidence can proceed together.
- Within US3, parity and authorization evidence can proceed while the reader runtime and
  authorization service are implemented.
- Within US4, structural reader and formula evidence can proceed together.

## Implementation Strategy

The MVP is US1 through a current ready preview. The releasable vertical slice requires US1,
US2 and US3 because the clean switch cannot ship with a parallel old workbench or preview.
US4 and all release evidence are mandatory before feature completion.
