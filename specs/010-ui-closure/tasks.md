# Tasks: UI Correctness and Shell Closure

**Input**: `specs/010-ui-closure/spec.md` and `plan.md`

## Phase 1: Reader Structure

**Goal**: Make semantic reader headings scan correctly without changing generated output.

**Independent test**: A representative page exposes distinct, wrapping `h1`–`h4` headings with visible fragment targets at required widths.

- [x] T001 [US1] Add the shared heading hierarchy while retaining the existing target spacing in `src/styles/reader.css`
- [x] T002 [US1] Add focused ReaderShell heading assertions in `tests/contract/style-system.test.ts` and `tests/e2e/library-reading.spec.ts`

## Phase 2: Book Details

**Goal**: Finish cover, action ordering, bounded TOC, and mobile dialog behavior.

**Independent test**: Real/missing covers and long TOCs render correctly, with at most 16 links and a full-screen 360 px dialog while route navigation still works.

- [x] T003 [US2] Render cover/fallback, place downloads before the bounded TOC, and expose the full-reading link in `src/web/components/library/BookDetails.tsx`
- [x] T004 [US2] Correct detail CSS and implement bounded desktop/full-viewport mobile layout in `src/pages/books/[bookKey]/index.astro`
- [x] T005 [US2] Extend existing detail component and browser behavior coverage in `tests/unit/library/book-details-interaction.test.tsx` and `tests/e2e/library-reading.spec.ts`

## Phase 3: Shared Management Shell

**Goal**: Give the four management routes one responsive hierarchy without changing their islands.

**Independent test**: Each route has the same three primary links, exactly one current item, and unchanged task controls at desktop and mobile widths.

- [x] T006 [US3] Create the responsive shared shell in `src/web/components/manage/ManageShell.astro`
- [x] T007 [US3] Adopt the shell in `src/pages/manage/index.astro`, `src/pages/manage/tasks.astro`, `src/pages/manage/security.astro`, and `src/pages/manage/books/[bookId]/preview.astro`, including the Passkey CSS correction
- [x] T008 [US3] Add focused shared-navigation and responsive assertions in `tests/e2e/manage-shell.spec.ts`

## Phase 4: Quiet Public Library

**Goal**: Avoid the anonymous protected-API probe while retaining private administration.

**Independent test**: Anonymous hydration receives no management `4xx` and makes no protected library call; an administrator still loads the existing management projection; public HTML/ETag stay identical.

- [x] T009 [US4] Implement the minimal private capability response in `src/pages/api/library/management-capability.ts`
- [x] T010 [US4] Gate the existing protected fetch in `src/web/components/library/AdminLibraryEnhancement.tsx`
- [x] T011 [US4] Cover capability authorization, cache headers, request gating, and public HTML identity in `tests/integration/auth/full-route-matrix.test.ts`, `tests/contract/library-reading.contract.test.ts`, `tests/e2e/library-reading.spec.ts`, and `tests/e2e/manage-shell.spec.ts`

## Phase 5: Verification And Closure

- [x] T012 Run format, lint, typecheck, focused unit/integration/contract/E2E tests, and build per `specs/010-ui-closure/quickstart.md`
- [x] T013 Update `docs/research/ui-ux-audit-2026-07-26.md`, run Spec Kit converge, and commit the completed feature

## Order

US1 and US2 may be implemented together. US3 and US4 are independent. T012–T013 follow all four stories.

## Phase 6: Import And Task Feedback

**Goal**: Keep an accepted upload visible and make background work understandable without job IDs.

**Independent test**: A controlled upload shows one filename, preserves source/stage after `202`, renders honest progress, and produces task cards led by operation and book/ZIP identity.

- [x] T014 [US5] Add failing storage, private projection, and browser assertions in `tests/integration/storage/multipart-import.test.ts`, `tests/e2e/import-upload.spec.ts`, and `tests/e2e/worker-recovery.spec.ts`
- [x] T015 [US5] Persist the cleaned ZIP display name through `src/http/multipart/import-form.ts`, `src/modules/publishing/adapters/filesystem/import-upload.ts`, `src/modules/publishing/adapters/sqlite/imports.ts`, and `src/platform/sqlite/migrations/0001_clean_slate.sql`
- [x] T016 [US5] Add private import/task subjects at the composition and API boundary in `src/composition/server.ts`, `src/modules/publishing/adapters/sqlite/job-status.ts`, and the management API routes
- [x] T017 [US5] Implement single filename presentation and continuous honest progress in `src/web/components/import/ImportUploader.tsx`
- [x] T018 [US5] Implement human-readable task cards and determinate progress in `src/web/components/import/TaskMonitor.tsx`
- [x] T019 [US5] Run focused integration/E2E feedback loops, format, lint, typecheck, build, and Spec Kit converge
