# Tasks: Publishing Quality Closure

**Input**: Design documents from `specs/004-publishing-quality/`

**Tests**: Required for schema evolution, hostile/ambiguous source handling, publication
atomicity, recovery, search exclusion, renderer assets, preview parity and performance.

## Phase 1: Setup

**Purpose**: Establish deterministic fixtures and renderer identity inputs without changing
runtime behavior.

- [x] T001 Create compact synthetic printed-contents, ambiguous-contents and formula fixtures in `tests/fixtures/publishing-quality/`
- [x] T002 [P] Record the pinned KaTeX asset adaptation and license obligations in `docs/third-party/code-provenance.md`
- [x] T003 [P] Add generated renderer asset paths and private evidence outputs to `.gitignore`

---

## Phase 2: Foundational schema and compiler seams

**Purpose**: Add strict read-old/write-new configuration support and shared data types needed
by every user story.

**Critical**: No story implementation begins until these tasks pass.

- [x] T004 Add failing strict v1/v2 schema, unknown-version, range-bound, preprocessing-provenance and migration-default contract cases in `tests/contract/book-schema.test.ts`
- [x] T005 Freeze v1 and define strict v2 source-region and typography-provenance schemas/examples in `docs/schemas/book.v1.schema.json`, `docs/schemas/book.schema.json`, `docs/schemas/examples/book.v2.yaml` and `docs/schemas/README.md`
- [x] T006 Implement schema dispatch, new-import `zh-smart-v1` provenance and deterministic v1-to-v2 `preserve-v1` migration in `src/schemas/book-config.ts` and `src/schemas/versioning.ts`
- [x] T007 Update runtime schema packaging for both supported versions in `scripts/copy-runtime-schemas.mjs`
- [x] T008 Define shared source-region, entry-mapping, typography-provenance, structured-diagnostic and semantic-identity types in `src/compiler/document/types.ts` and `src/domain/errors.ts`
- [x] T009 Add canonical configured-document identity helpers and bump compiler, renderer and text-normalization constants in `src/compiler/document/manifest.ts`
- [x] T010 Add failing exact mixed-script spacing, punctuation, protected-token, cross-inline-context, non-target-byte preservation and second-pass idempotency cases in `tests/unit/compiler/typography.test.ts`
- [x] T011 Implement deterministic `preserve-v1` and `zh-smart-v1` source-slice preprocessing, protected-token segmentation, minimal UTF-8 replacements and bounded provenance in `src/compiler/preprocess/typography.ts`
- [ ] T012 Run and atomically persist preprocessing before accepted-source hashing/structure proposal, expose provenance and implement the preconditioned re-preprocess-to-new-revision contract in `src/jobs/handlers/prepare-draft.ts`, `src/services/config-revisions.ts`, `src/pages/api/manage/books/[bookId]/reprocess.ts` and `src/components/preview/StructurePreview.tsx`

**Checkpoint**: Strict v1/v2 validation and migration are available without changing v1
publication behavior.

---

## Phase 3: User Story 1 — Remove printed contents and reconstruct body structure (P1)

**Goal**: Detect only high-confidence printed contents, preserve the Markdown, exclude the
confirmed region from every derived consumer and apply auditable body hierarchy proposals.

**Independent Test**: Import the synthetic repeated printed-contents fixture, inspect and
accept the proposal, publish it and observe zero printed-contents blocks in body, TOC,
numbering, pages, outline and search while frozen source bytes remain equal.

### Evidence tests

- [ ] T013 [P] [US1] Add failing detection, hierarchy, Unicode byte-range, ordinary “目录”, duplicate-label, OCR and rich-content tests in `tests/unit/compiler/printed-toc.test.ts`
- [ ] T014 [P] [US1] Add failing range hash, AST-boundary, overlap, mapping-order, cross-reference and reversible-filter tests in `tests/unit/compiler/source-regions.test.ts`
- [ ] T015 [P] [US1] Add failing end-to-end configured-document numbering/page/manifest/search exclusion tests in `tests/integration/compiler/configured-document.test.ts`
- [ ] T016 [P] [US1] Add failing initial-draft proposal and bounded diagnostic recovery tests in `tests/integration/recovery/prepare-preview.test.ts`

### Implementation

- [ ] T017 [US1] Implement UTF-8 byte conversion, region hash validation, root-block filtering and active-document derivation in `src/compiler/document/source-regions.ts`
- [ ] T018 [US1] Implement conservative printed-contents extraction, exact monotonic matching, confidence gates and title-free entry mappings in `src/compiler/document/printed-toc.ts`
- [ ] T019 [US1] Extend structure proposal generation to apply printed hierarchy and explicit body numbering without changing ambiguous headings in `src/compiler/document/structure-proposal.ts`
- [ ] T020 [US1] Refactor semantic structure validation to bind all source headings but validate levels, roles and pages only on active headings in `src/compiler/document/validate-config.ts`
- [ ] T021 [US1] Generate v2 configs, confirmed high-confidence regions and bounded candidate diagnostics during import in `src/jobs/handlers/prepare-draft.ts`
- [ ] T022 [US1] Make resource resolution, manifest and search consume only the active filtered document and reject active references to excluded definitions or footnotes in `src/compiler/resources/resolver.ts`, `src/compiler/document/manifest.ts` and `src/compiler/search/build-spool.ts`
- [ ] T023 [US1] Add source-region summary, applied state and a bulk reversible control to `src/components/preview/StructurePreview.tsx` and `src/components/preview/StructureEditor.tsx`
- [ ] T024 [US1] Extend draft reads and atomic config replacement to expose/migrate/validate source regions without changing accepted source in `src/pages/api/manage/books/[bookId]/draft.ts` and `src/services/config-revisions.ts`

**Checkpoint**: User Story 1 is independently usable and no reader-specific hiding logic
exists.

---

## Phase 4: User Story 2 — Preview exactly what publication will build (P2)

**Goal**: Replace the raw one-page preview renderer with the publication compiler's
configured document, pages, semantic renderer and diagnostic policy.

**Independent Test**: Build preview and publication from equal captured inputs and compare
page count, hierarchy, numbering, semantic digest and diagnostic codes; then change config
or compiler identity and observe publication reject the stale preview.

### Evidence tests

- [ ] T025 [P] [US2] Add failing preview/publication page, heading, numbering, diagnostics and semantic-digest parity cases in `tests/integration/compiler/preview-publication-parity.test.ts`
- [ ] T026 [P] [US2] Add failing stale source/config/compiler/renderer preview publication contract cases in `tests/integration/publication/stale-preview.test.ts`
- [ ] T027 [P] [US2] Add failing private preview multi-page and response-policy cases in `tests/contract/config-publish.contract.test.ts`

### Implementation

- [ ] T028 [US2] Extract configured parsing, stable heading assignment, active filtering, validation, numbering, page splitting and semantic identity into `src/compiler/document/configured-document.ts`
- [ ] T029 [US2] Refactor immutable version building to consume the shared configured-document result in `src/compiler/version-builder.ts`
- [ ] T030 [US2] Refactor preview building to emit every shared semantic page and real structured diagnostics through `renderSemanticDocument` in `src/jobs/handlers/build-preview.ts`
- [ ] T031 [US2] Remove the obsolete independent preview renderer in `src/compiler/render/preview.ts` and update its callers/tests
- [ ] T032 [US2] Extend preview model reads and management UI to show captured hashes, compiler identity, all pages and structured diagnostics in `src/pages/api/manage/books/[bookId]/draft.ts`, `src/components/preview/StructurePreview.tsx` and `src/components/preview/DiagnosticsPanel.tsx`
- [ ] T033 [US2] Enforce current ready-preview source/config/compiler/renderer/semantic identities before queuing publication in `src/pages/api/manage/books/[bookId]/publish.ts`

**Checkpoint**: A ready preview is a faithful, captured publication decision rather than a
separate approximation.

---

## Phase 5: User Story 3 — Render one accessible formula with matching local assets (P3)

**Goal**: Unify KaTeX engine identity and deliver exact local CSS/fonts so MathML remains
accessible but not visually duplicated.

**Independent Test**: Load formula fixtures in preview and published readers, observe one
visible representation per formula, accessible MathML, a matching renderer identity and no
failed CSS/font request.

### Evidence tests

- [ ] T034 [P] [US3] Add failing single-KaTeX-version, CSS rewrite, font closure, license and integrity-manifest tests in `tests/unit/compiler/renderer-assets.test.ts`
- [ ] T035 [P] [US3] Add failing renderer stylesheet link and renderer-version manifest cases in `tests/integration/compiler/semantic-render.test.ts` and `tests/integration/compiler/version-builder.test.ts`
- [ ] T036 [P] [US3] Add failing computed typography, protected-token, formula visibility, accessibility, CSS/font request and invalid-formula parity cases in `tests/e2e/publishing-quality.spec.ts`

### Implementation

- [ ] T037 [US3] Pin one KaTeX 0.18.1 dependency graph and add renderer-asset preparation hooks in `package.json` and `pnpm-lock.yaml`
- [ ] T038 [US3] Implement deterministic woff2-only CSS/font/license/integrity generation in `scripts/prepare-renderer-assets.mjs`
- [ ] T039 [US3] Link the shared renderer stylesheet from preview fragments and published HTML and use `semantic-html-v3-katex-0.18.1` in `src/compiler/version-builder.ts`, `src/jobs/handlers/build-preview.ts` and `src/compiler/document/manifest.ts`
- [ ] T040 [US3] Make formula validation and rehype rendering use the same pinned options and preserve a single fallback in `src/compiler/render/math.ts` and `src/compiler/render/document.ts`
- [ ] T041 [US3] Verify generated renderer assets enter local Astro and Docker production closures without runtime writes in `tests/integration/deployment/production-topology.test.ts` and `docs/operations/deployment.md`

**Checkpoint**: Formula-heavy pages are visually correct, accessible, self-hosted and tied
to the immutable renderer identity.

---

## Phase 6: User Story 4 — Rebuild safely across configuration versions (P4)

**Goal**: Preserve every v1 draft/version and make v2 edits/rebuilds strict, deterministic
and rollback-safe.

**Independent Test**: Load and build strict v1 and v2 fixtures, save a v1 draft as v2,
reject malformed/unsupported v2 data and prove every failed rebuild leaves the previous
current version and old directory hashes unchanged.

### Evidence tests

- [ ] T042 [P] [US4] Add v1 read/build, read-old/write-new `preserve-v1`, new-import `zh-smart-v1`, deterministic migration and v2 round-trip cases in `tests/integration/publication/config-revisions.test.ts`
- [ ] T043 [P] [US4] Add invalid region, interrupted build, retry and old-current preservation cases in `tests/integration/publication/crash-boundaries.test.ts` and `tests/integration/recovery/reconciliation.test.ts`
- [ ] T044 [P] [US4] Add immutable old-directory and renderer-identity republish cases in `tests/integration/compiler/reproducibility.test.ts`

### Implementation

- [ ] T045 [US4] Complete read-old/write-new behavior across draft reads, config saves, preview and publication in `src/services/config-revisions.ts`, `src/jobs/handlers/build-preview.ts` and `src/compiler/version-builder.ts`
- [ ] T046 [US4] Extend version verification and recovery to validate v1/v2 config files without rewriting immutable versions in `src/services/version-verifier.ts` and `src/services/reconciliation.ts`
- [ ] T047 [US4] Update schema compatibility fixtures, runtime docs and examples in `docs/schemas/`, `tests/fixtures/schemas/` and `docs/operations/deployment.md`

**Checkpoint**: Existing versions remain readable and immutable; all new edits use strict v2
and normal atomic publication.

---

## Phase 7: Polish and cross-cutting release evidence

**Purpose**: Close end-to-end quality, performance, documentation and Spec Kit gates.

- [ ] T048 [P] Add full management acceptance for proposal review, bulk reversal, typography summary, preview parity and republish in `tests/e2e/configure-publish.spec.ts`
- [ ] T049 [P] Update compiler, preview, publication and response-class evidence in `docs/audits/publishing-quality-release.md`
- [ ] T050 Run registered real MinerU and synthetic stress validation and record only opaque fixture evidence in `docs/audits/publishing-quality-results.json`
- [ ] T051 Run reader and reference benchmarks during rebuild and document p95/resource results in `docs/audits/publishing-quality-release.md`
- [ ] T052 Run `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build`, fixing all regressions in affected files
- [ ] T053 Synchronize product, architecture, schema, operations, quickstart and third-party documentation in `docs/` and `specs/004-publishing-quality/`
- [ ] T054 Run Spec Kit analyze and converge, resolve every unmitigated CRITICAL finding and mark completed tasks in `specs/004-publishing-quality/tasks.md`
- [x] T055 [P] Add nested full-book TOC, current-branch, breadcrumb, page-outline and no-script navigation evidence in `tests/unit/library/reader-interaction.test.ts` and `tests/integration/compiler/version-builder.test.ts`
- [x] T056 Generate canonical heading navigation inputs and render native collapsible hierarchy, current location and scroll-aware page outline in `src/compiler/version-builder.ts` and `src/components/reader/`
- [x] T057 Add desktop/mobile reader navigation acceptance for branch toggling, ordinary links, scroll highlighting and drawer behavior in `tests/e2e/library-reading.spec.ts`
- [x] T058 Add pinned Tailwind CSS v4 Vite/CLI integration, one global theme entry and a deterministic standalone reader stylesheet build in `astro.config.mjs`, `package.json` and `src/styles/`
- [x] T059 Replace product-source color literals with approved Tailwind palette utilities/tokens and add the D-106 static style-token gate to normal lint
- [x] T060 Verify global application styling, immutable reader stylesheet delivery, desktop/mobile reader navigation and production asset closure in unit, contract, integration and Playwright tests

---

## Dependencies and execution order

### Phase dependencies

- **Setup (Phase 1)**: Starts immediately.
- **Foundational (Phase 2)**: Depends on Setup and blocks all stories.
- **US1 (Phase 3)**: First MVP; establishes active document filtering.
- **US2 (Phase 4)**: Depends on US1's configured active document.
- **US3 (Phase 5)**: Depends on US2's shared preview/publication rendering seam; its asset
  builder tests can start after Foundation.
- **US4 (Phase 6)**: Depends on schema foundation and final shared builders from US2/US3.
- **Release (Phase 7)**: Depends on all stories.

### User story dependency graph

```text
Foundation → US1 → US2 → US3 → US4 → Release
             └──────────────→ US4
```

### Parallel opportunities

- T002–T003 can run in parallel.
- T013–T016 are independent failing-test seams.
- T025–T027 are independent parity, stale-state and contract seams.
- T034–T036 independently cover asset generation, compiler output and browser behavior.
- T042–T044 independently cover configuration compatibility, recovery and immutability.
- T048–T049 can proceed in parallel after all story implementations; T050–T051 can run in
  parallel only if they do not compete for the same benchmark host resources.

## Implementation strategy

### MVP first

1. Complete setup and strict schema foundation.
2. Complete US1 with synthetic fixtures.
3. Demonstrate source preservation and zero printed-contents contamination.

### Incremental closure

1. Replace preview divergence through US2.
2. Fix the immediately visible formula defect through US3.
3. Prove old-version compatibility and recovery through US4.
4. Run real fixtures, performance, analysis and convergence only after the deterministic
   automated suite is green.

## Format validation

All 60 tasks use the required checkbox, sequential task ID, optional parallel marker,
required user-story label inside story phases, an actionable description and explicit file
path.
