# Tasks: Library and Reading Loop

**Input**: Design documents from `/specs/003-library-reading-loop/`

**Prerequisites**: spec.md, plan.md, research.md, data-model.md, contracts/, checklists/

**Tests**: Migration, authorization, cache, publication, recovery, accessibility, browser
and performance evidence are mandatory. Constitution-critical evidence precedes the runtime
behavior it protects.

**Organization**: Tasks are grouped by independently testable user story after shared
version-projection foundations.

## Phase 1: Setup

**Purpose**: Freeze the approved M2a boundary and testing surfaces.

- [x] T001 Synchronize D-099/D-100, the M2a product boundary and all Phase 1 design artifacts in `docs/decisions/decision-log.md`, `docs/product/product-spec.md`, and `specs/003-library-reading-loop/`
- [x] T002 Add direct accessibility-test dependency and dedicated mobile/no-JavaScript Playwright projects in `package.json`, `pnpm-lock.yaml`, and `playwright.config.ts`

---

## Phase 2: Foundational version projection

**Purpose**: Guarantee current-version metadata, alias, migration and recovery behavior
before any new public route can consume it.

- [x] T003 [P] Add failing migration and v5 compatibility evidence for projection schema 6 in `tests/integration/storage/migrations.test.ts`
- [x] T004 [P] Add failing projection derivation, strict bounds, digest, cover and TOC fixture tests in `tests/unit/library/book-presentation.test.ts`
- [x] T005 [P] Add failing ready-registration, alias-cutover, draft-leak and projection/FTS rollback evidence in `tests/integration/publication/book-presentations.test.ts`
- [x] T006 [P] Add failing missing-projection backfill, mismatch, recovery and reclamation evidence in `tests/integration/recovery/book-presentations.test.ts`
- [x] T007 Create checksummed migration 6 and register it in `src/db/migrations/0006_book_version_presentations.sql` and `src/db/migration-manifest.ts`
- [x] T008 Implement strict bounded projection types, canonical digest and derivation from validated `book.yaml` plus manifest in `src/services/book-presentation.ts`
- [x] T009 Implement projection persistence and current-version queries in `src/db/repositories/book-presentations.ts`
- [x] T010 Generate the projection in the immutable build artifact and register ready version, projection and FTS rows atomically in `src/compiler/version-builder.ts`, `src/jobs/handlers/build-publish.ts`, and `src/db/repositories/versions.ts`
- [x] T011 Promote the frozen alias and verify projection identity in the current-pointer transaction without mutating public alias during draft edits in `src/services/publication.ts`, `src/db/repositories/drafts.ts`, and `src/services/config-revisions.ts`
- [x] T012 Rebuild missing projections, validate digests and protect rollback candidates during worker reconciliation and reclamation in `src/storage/reconcile.ts`, `src/services/version-verifier.ts`, and `src/jobs/handlers/reclaim.ts`
- [x] T013 Replace mutable draft title/alias reads in published-book and search result resolution with current presentation data in `src/services/published-book.ts`, `src/db/repositories/book-search.ts`, and `src/compiler/search/query.ts`

**Checkpoint**: Schema 6 upgrades safely; existing versions reconcile off-request; new
versions cannot become current without one matching projection.

---

## Phase 3: User Story 1 - Discover and open a published book (Priority: P1) 🎯 MVP

**Goal**: `/library` exposes a semantic, cache-safe root library and leads to reading or
details in no more than two actions.

**Independent Test**: Seed two public current books plus draft/private/ready/old rows, visit
anonymously with and without JavaScript, and confirm only the two current public projections
appear with working reading and details links.

- [x] T014 [P] [US1] Add failing public/private/version/filter/empty/partial-unavailable library service tests in `tests/integration/library/library-service.test.ts`
- [x] T015 [P] [US1] Add failing library HTML, ETag, canonical, cache, indexing and session-byte-identity contract tests in `tests/contract/library-reading.contract.test.ts`
- [x] T016 [P] [US1] Add failing semantic card, placeholder and optional-metadata component tests in `tests/unit/library/library-components.test.tsx`
- [x] T017 [US1] Implement bounded public and administrator library view models and representation digests in `src/services/library.ts`
- [x] T018 [P] [US1] Implement semantic book cards, title placeholders, empty and partial-unavailable states in `src/components/library/BookCard.tsx` and `src/components/library/LibraryScene.tsx`
- [x] T019 [P] [US1] Implement public HTML conditional response helpers and public JSON noindex policy in `src/http/cache/library-response.ts` and `src/http/cache/policies.ts`
- [x] T020 [US1] Implement full SSR `/library` with canonical metadata and current-version-only results in `src/pages/library/index.astro`
- [x] T021 [US1] Implement paginated private administrator entries and client enhancement in `src/pages/api/manage/library.ts` and `src/components/library/AdminLibraryEnhancement.tsx`
- [x] T022 [US1] Add the semantic library entry point without featured shelves in `src/pages/index.astro`

**Checkpoint**: Anonymous discovery is complete and useful without JavaScript; administrator
state never enters public HTML.

---

## Phase 4: User Story 2 - Inspect details without losing library context (Priority: P2)

**Goal**: `/books/:bookKey` works as a directly addressable details dialog and restores the
library context when enhanced navigation closes.

**Independent Test**: Open details from a scrolled library and by direct URL, exercise
close/Escape/Back, then validate metadata, TOC, downloads, aliases and hidden/unavailable
states.

- [x] T023 [P] [US2] Add failing current projection, bounded TOC/originals, alias, 404/503 and conditional details service tests in `tests/integration/library/book-details.test.ts`
- [x] T024 [P] [US2] Extend failing HTML/JSON route contracts for details authorization, cache, indexing and canonical behavior in `tests/contract/library-reading.contract.test.ts`
- [x] T025 [P] [US2] Add failing dialog semantics, close fallback and context-record validation tests in `tests/unit/library/book-details-interaction.test.tsx`
- [x] T026 [US2] Implement bounded public/private details resolution from projection, originals and canonical key in `src/services/library.ts`
- [x] T027 [P] [US2] Implement details content, TOC preview, download labels and accessible native dialog markup in `src/components/library/BookDetails.tsx`
- [x] T028 [P] [US2] Implement same-origin expiring scroll/focus history enhancement in `src/components/library/details-navigation.ts`
- [x] T029 [US2] Implement public noindex details JSON with authorization-before-conditional handling in `src/pages/api/books/[bookKey]/details.ts`
- [x] T030 [US2] Implement direct SSR details route over the library backdrop with public/private/error policies in `src/pages/books/[bookKey]/index.astro`

**Checkpoint**: Details are complete through ordinary links, enhanced modal navigation and
direct URLs without losing library context or cache safety.

---

## Phase 5: User Story 3 - Read and navigate on desktop or mobile (Priority: P3)

**Goal**: The generated reader has a working library return, bounded mobile drawers,
isolated search instances and safe keyboard navigation.

**Independent Test**: Publish a multi-page renderer-v2 fixture, then navigate by TOC,
outline, search, previous/next and keyboard at desktop and 360-pixel widths with JavaScript
enabled and disabled.

- [x] T031 [P] [US3] Add failing keyboard guard, multiple-search-instance and mobile drawer component tests in `tests/unit/library/reader-interaction.test.ts`
- [x] T032 [P] [US3] Add failing current presentation title/canonical/search-link and private-transition reader integration tests in `tests/integration/library/reader-loop.test.ts`
- [x] T033 [US3] Refactor search enhancement to initialize each bounded search container independently in `src/components/reader/BookSearch.tsx`
- [x] T034 [US3] Add semantic mobile TOC, page-outline, search and download dialogs with focus restoration in `src/components/reader/ReaderShell.tsx`
- [x] T035 [US3] Harden arrow-key exclusions, hash target focus and responsive drawer lifecycle in `src/components/reader/ReaderShell.tsx`
- [x] T036 [US3] Deliver responsive focus-visible/reduced-motion reader styles and bump compiler/renderer identity for newly published immutable pages in `src/components/reader/render.ts` and `src/compiler/document/manifest.ts`

**Checkpoint**: Newly published books provide the complete desktop/mobile/no-script reader
loop while old immutable renderer-v1 pages remain readable.

---

## Phase 6: User Story 4 - Continue from publication into the reader (Priority: P4)

**Goal**: Publication progress ends in clear canonical details, reading and library actions
only after atomic cutover.

**Independent Test**: Publish a prepared draft, observe reader-facing phases, follow each
success action and confirm all surfaces use the new version; inject stale/failure/cancel
outcomes and confirm the old version remains the only live destination.

- [x] T037 [P] [US4] Add failing progress-label, success-action and terminal-failure component tests in `tests/unit/library/publish-outcome.test.tsx`
- [x] T038 [P] [US4] Add publish-to-library/current-version and stale/failure browser evidence in `tests/e2e/configure-publish.spec.ts` and `tests/e2e/library-reading.spec.ts`
- [x] T039 [US4] Expose only bounded canonical publication outcome fields after committed success in `src/services/job-status.ts` and `src/pages/api/manage/jobs/[jobId]/index.ts`
- [x] T040 [US4] Implement reader-facing phase labels and post-cutover details/read/library actions in `src/components/preview/PublishPanel.tsx`
- [x] T041 [US4] Integrate administrator draft/private card destinations with preview, task and current private reader surfaces in `src/components/library/AdminLibraryEnhancement.tsx`

**Checkpoint**: The administrator can continue from import and publication directly into
the same current-version surfaces used by readers.

---

## Phase 7: Cross-cutting evidence and release

**Purpose**: Prove accessibility, cache isolation, performance, documentation and complete
Spec Kit convergence.

- [x] T042 [P] Add desktop, 360-pixel mobile, no-JavaScript, scroll/focus restoration, visibility-transition and accessibility journeys in `tests/e2e/library-reading.spec.ts`
- [x] T043 [P] Extend the full route/response matrix for library, details, public JSON, private enhancement, 404, 503 and old ETags in `tests/integration/auth/full-route-matrix.test.ts` and `tests/integration/http/cache-indexing.test.ts`
- [x] T044 Implement and run the 1,000-book concurrent-rebuild library/details benchmark in `scripts/benchmarks/library.ts`, `package.json`, and `docs/audits/m2a-library-performance.md`
- [x] T045 Synchronize architecture, deployment, recovery, schema and runtime guidance with projection and reader behavior in `docs/architecture/m1-architecture.md`, `docs/operations/deployment.md`, `docs/operations/recovery.md`, `docs/schemas/README.md`, and `README.md`
- [x] T046 Run formatting, lint, typecheck, unit, integration, contract, browser, build, migration-recovery and benchmark gates and record exact results in `specs/003-library-reading-loop/quickstart.md` and `docs/audits/m2a-library-release-verification.md`
- [x] T047 Perform final Spec Kit analysis with no unmitigated CRITICAL finding and record the consistency result in `docs/audits/m2a-library-consistency.md`
- [x] T048 Run Spec Kit convergence, append any remaining implementation work to `specs/003-library-reading-loop/tasks.md`, complete it, and leave the feature status and all tasks synchronized

---

## Dependencies and execution order

- Phase 1 precedes all implementation.
- Phase 2 is a hard gate for every public story because mutable draft caches cannot safely
  back a current public route.
- User Story 1 is the independently useful MVP and blocks the shared library backdrop used
  by User Story 2.
- User Story 2 blocks the full publication destination in User Story 4.
- User Story 3 can proceed after Phase 2 in parallel with User Stories 1–2 because it edits
  generated reader files, but final browser evidence needs the library route.
- User Story 4 depends on User Stories 1 and 2 and reuses the reader entry from User Story 3.
- Phase 7 follows all four stories.

## Parallel execution examples

- **Foundation**: T003, T004, T005 and T006 define independent migration, derivation,
  publication and recovery evidence before T007–T013.
- **User Story 1**: T014, T015 and T016 can run in parallel; after T017, T018 and T019 can
  proceed on separate component/cache files before route integration.
- **User Story 2**: T023, T024 and T025 can run in parallel; T027 and T028 can proceed after
  their contracts while T026 supplies shared data.
- **User Story 3**: T031 and T032 can run in parallel before the search, markup and style
  implementation.
- **User Story 4**: T037 and T038 can run in parallel before status and panel changes.
- **Release**: T042, T043, T044 and T045 touch independent evidence/documentation surfaces.

## Implementation strategy

1. Freeze current-version projection and response contracts.
2. Establish failing migration, publication, recovery and cache evidence.
3. Make the public root library independently usable.
4. Add direct and enhanced book details.
5. publish the renderer-v2 reader shell and mobile interactions.
6. Connect committed publication outcomes to library/details/read routes.
7. Run full gates, analyze consistency and converge until no task remains.

## MVP scope

The MVP is Phase 2 plus User Story 1: a secure, version-consistent `/library` with direct
reading/details links and private administrator augmentation. The goal for this feature,
however, includes all four user stories and the complete release phase.
