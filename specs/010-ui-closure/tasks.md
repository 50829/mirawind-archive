# Tasks: UI Correctness and Shell Closure

**Input**: `specs/010-ui-closure/spec.md` and `plan.md`

## Phase 1: Reader Structure

**Goal**: Make semantic reader headings scan correctly without changing generated output.

**Independent test**: A representative page exposes distinct, wrapping `h1`–`h4` headings with visible fragment targets at required widths.

- [ ] T001 [US1] Add the shared heading hierarchy and target spacing in `src/styles/reader.css`
- [ ] T002 [US1] Add focused ReaderShell heading assertions to the existing reader tests in `tests/unit/library/reader-interaction.test.ts` and `tests/e2e/publishing-quality.spec.ts`

## Phase 2: Book Details

**Goal**: Finish cover, action ordering, bounded TOC, and mobile dialog behavior.

**Independent test**: Real/missing covers and long TOCs render correctly, with at most 16 links and a full-screen 360 px dialog while route navigation still works.

- [ ] T003 [US2] Render cover/fallback, place downloads before the bounded TOC, and expose the full-reading link in `src/web/components/library/BookDetails.tsx`
- [ ] T004 [US2] Correct detail CSS and implement bounded desktop/full-viewport mobile layout in `src/pages/books/[bookKey]/index.astro`
- [ ] T005 [US2] Extend existing detail component and browser behavior coverage in `tests/unit/library/book-details-interaction.test.tsx` and `tests/e2e/library-reading.spec.ts`

## Phase 3: Shared Management Shell

**Goal**: Give the four management routes one responsive hierarchy without changing their islands.

**Independent test**: Each route has the same three primary links, exactly one current item, and unchanged task controls at desktop and mobile widths.

- [ ] T006 [US3] Create the responsive shared shell in `src/web/components/manage/ManageShell.astro`
- [ ] T007 [US3] Adopt the shell in `src/pages/manage/index.astro`, `src/pages/manage/tasks.astro`, `src/pages/manage/security.astro`, and `src/pages/manage/books/[bookId]/preview.astro`, including the Passkey CSS correction
- [ ] T008 [US3] Add focused shared-navigation and responsive assertions in `tests/e2e/manage-shell.spec.ts`

## Phase 4: Quiet Public Library

**Goal**: Avoid the anonymous protected-API probe while retaining private administration.

**Independent test**: Anonymous hydration receives no management `4xx` and makes no protected library call; an administrator still loads the existing management projection; public HTML/ETag stay identical.

- [ ] T009 [US4] Implement the minimal private capability response in `src/pages/api/library/management-capability.ts`
- [ ] T010 [US4] Gate the existing protected fetch in `src/web/components/library/AdminLibraryEnhancement.tsx`
- [ ] T011 [US4] Cover capability authorization and cache headers in `tests/integration/auth/full-route-matrix.test.ts`, request gating in `tests/unit/library/library-components.test.tsx`, and public HTML identity in `tests/contract/library-reading.contract.test.ts`

## Phase 5: Verification And Closure

- [ ] T012 Run format, lint, typecheck, focused unit/integration/contract/E2E tests, and build per `specs/010-ui-closure/quickstart.md`
- [ ] T013 Update `docs/research/ui-ux-audit-2026-07-26.md`, run Spec Kit converge, and commit the completed feature

## Order

US1 and US2 may be implemented together. US3 and US4 are independent. T012–T013 follow all four stories.
