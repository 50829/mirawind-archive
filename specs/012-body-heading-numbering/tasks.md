# Tasks: Body Heading Numbering

**Input**: Design documents from `/specs/012-body-heading-numbering/`
**Prerequisites**: Approved D-122, spec, plan, research, data model, management API contract and checklists

## Phase 1: Setup And Governance

**Purpose**: Establish the approved semantics and traceable feature artifacts.

- [x] T001 Record D-122 in `docs/decisions/decision-log.md` and synchronize section 11.2 of
      `docs/product/product-spec.md`.
- [x] T002 Create feature 012 specification, plan, research, data model, contract, quickstart and checklists
      under `specs/012-body-heading-numbering/`.

---

## Phase 2: Foundational Tests

**Purpose**: Lock the shared semantic and persistence boundaries before implementation.

- [x] T003 [P] Add failing role-aware generated/source/none and non-H1 body-start tests in
      `tests/integration/compiler/pages-manifest.test.ts`.
- [x] T004 [P] Add failing technical-number and rich-Markdown prefix tests in
      `tests/unit/compiler/structure-proposal.test.ts`.
- [x] T005 [P] Add failing draft numbering GET/PATCH, invalid-enum, ETag and immutable-revision tests in
      `tests/integration/publication/config-revisions.test.ts` and the relevant route contract test.
- [x] T006 [P] Add failing local numbering dirty/merge/discard/conflict state tests in
      `tests/unit/library/structure-editor-state.test.ts` or a focused StructureEditor component test.

**Checkpoint**: Each new behavior has a focused failing test and no production implementation has changed.

---

## Phase 3: User Story 2 - Number Only正文 (Priority: P1)

**Goal**: Generated numbering appears only on正文 and never emits zero-prefixed components.

**Independent Test**: Compile one four-role document whose正文 starts below H1 and assert the exact shared
heading presentation and artifacts.

- [x] T007 [US2] Update generated numbering in
      `src/modules/publishing/core/publication/heading-presentation.ts` to skip every non-body role and normalize
      the active body hierarchy to positive components.
- [x] T008 [US2] Tighten prefix separation in
      `src/modules/publishing/core/preparation/heading-title.ts` so technical numeric titles are preserved and
      recognized rich-Markdown prefixes are removed exactly once.
- [x] T009 [US2] Extend page, TOC, outline, breadcrumb/page metadata, manifest and search-spool evidence in
      `tests/integration/compiler/pages-manifest.test.ts`.

**Checkpoint**: Core and cross-consumer tests prove body-only, positive, single-source numbering.

---

## Phase 4: User Story 1 - Choose The Book Numbering Mode (Priority: P1)

**Goal**: An administrator can load, choose and save one whole-book numbering policy.

**Independent Test**: PATCH source → generated with a current ETag, reload the draft, and verify the new
revision and building candidate expose generated mode.

- [x] T010 [US1] Extend `DraftView` and draft GET projection in `src/web/contracts/publishing.ts` and
      `src/pages/api/manage/books/[bookId]/draft.ts` with the authoritative numbering mode.
- [x] T011 [US1] Extend strict PATCH parsing and next-config assembly in
      `src/modules/publishing/adapters/filesystem/config-revisions.ts` with the three-value numbering enum.
- [x] T012 [US1] Add the 原书编号 / 自动编号 / 无编号 segmented control and accessible labeling to
      `src/web/components/manage/StructureEditor.tsx`, using existing Tailwind tokens.
- [x] T013 [US1] Pass the authoritative numbering prop from
      `src/web/components/manage/PublishingWorkbench.tsx` and include it in local snapshots, dirty state and
      PATCH payload.
- [x] T014 [US1] Complete authenticated route/UI evidence for valid save, invalid input, stale ETag and
      candidate scheduling in the focused integration and Playwright tests.

**Checkpoint**: The complete administrator save/rebuild path is independently usable.

---

## Phase 5: User Story 3 - Switch Modes Without Content Loss (Priority: P2)

**Goal**: All mode transitions preserve Markdown, source numbers and unrelated local changes.

**Independent Test**: Exercise source → generated → none → source and compare source/config data and all
display consumers at every candidate.

- [x] T015 [US3] Verify none mode suppresses every consumer while source mode retains numbers in all roles
      in `tests/integration/compiler/pages-manifest.test.ts`.
- [x] T016 [US3] Verify mode round trips preserve Markdown digests and `source_number` values in
      `tests/integration/publication/config-revisions.test.ts`.
- [x] T017 [US3] Verify accepted-save merge, discard/reload and `412` conflict retain the correct local
      numbering and unrelated heading edits in focused editor and Playwright tests.

**Checkpoint**: Reversibility and concurrent-edit recovery are demonstrated.

---

## Phase 6: Validation And Convergence

**Purpose**: Synchronize artifacts and pass proportionate repository gates.

- [x] T018 Run Prettier on feature artifacts and changed source/test files, then run focused unit,
      integration, contract and Playwright tests from `quickstart.md`.
- [x] T019 Run `pnpm typecheck`, `pnpm lint`, full `pnpm test` and `pnpm build`; record any unavailable
      representative performance evidence without weakening the existing gate.
- [x] T020 Validate the authenticated desktop/mobile workbench and ready preview on a local web/worker stack.
- [x] T021 Run Spec Kit analyze with no unmitigated CRITICAL findings and Spec Kit converge; implement any
      appended tasks, rerun affected gates and finish with every task checked.

---

## Phase 7: Review Remediation

**Purpose**: Close the staged-change review findings before commit.

- [x] T022 Replace delimiter-specific rich-number stripping with parsed inline-tree source-position
      separation, covering nested emphasis, links, inline code and formatting shared by the number and title.
- [x] T023 Cover generated body starts at H1-H4 and retain numbering plus an unrelated heading edit across
      the same `412` conflict workflow.
- [x] T024 Synchronize the living Draft OpenAPI GET, PATCH and accepted-response models with the D-121
      runtime contract and add contract drift assertions.
- [x] T025 Run formatting, focused tests, full repository gates, Spec Kit analyze and converge, then review
      the final staged diff before commit.

## Dependencies & Execution Order

- T001-T002 precede all implementation work.
- T003-T006 must fail for the expected reasons before T007-T013.
- T007-T009 establish compiler semantics independently of the management UI.
- T010-T014 complete the administrator workflow; T015-T017 then close round-trip behavior.
- T018-T021 depend on every user-story task.
- T022-T025 close review findings after the original implementation and precede commit.

## Implementation Strategy

Deliver the pure compiler semantics first, then the immutable API update, then the editor control. At every
stage preserve the single compiled heading representation and existing candidate/publication lifecycle; do
not introduce compatibility branches, schema changes or Markdown mutation.
