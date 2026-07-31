# Implementation Plan: UI Correctness and Shell Closure

**Branch**: `main` | **Date**: 2026-07-31 | **Spec**: [spec.md](spec.md)

## Summary

Make five focused changes: add ReaderShell heading styles, finish the existing book-details
presentation, wrap management routes in one Astro shell, gate the protected library
enhancement behind a minimal private capability check, and repair the import/task feedback
loop. Publishing formats, authorization, KaTeX, and public cache semantics remain unchanged.

## Technical Context

**Stack**: TypeScript 6, Astro 7, React 19, Tailwind CSS 4, Node.js 24
**Storage**: Current clean SQLite baseline adds one private import ZIP display-name field;
publication files are unchanged
**Tests**: Existing Vitest and Playwright suites plus focused behavior assertions
**Performance**: Preserve the 300 ms uncached reader target; anonymous library hydration has
zero expected management `4xx`; detail TOC DOM is capped at 16 rows

## Constitution Check

- Authoritative Markdown, `book.yaml`, manifests, catalog data, and immutable output are not
  modified. Per D-120, the current clean database baseline advances directly; no compatibility
  migration or parallel schema is retained.
- Publication transactions, worker behavior, resource authorization, and reader request work
  are unchanged.
- The only new response is a minimal session capability boolean using the existing private,
  no-store response policy. Actual management data remains fully protected.
- Existing representative reader/library/auth/cache tests remain required; focused browser
  checks cover layout, focus, and request behavior.
- The cleaned ZIP display name is private management context only. It is neither authoritative
  publishing metadata nor a public/cacheable value.
- No new service, process, database, router, state store, or UI kit is introduced.

**Result**: PASS before and after design.

## Implementation

### 1. Reader and details

- Add semantic `h1`-`h4` descendant styles and scroll margins in `src/styles/reader.css`.
- Fix the two malformed CSS properties.
- Render `coverUrl` or a title placeholder in `BookDetails`.
- Move downloads ahead of the TOC and slice the preview to 16 entries.
- Make the detail dialog full dynamic-viewport on mobile and at most 8 px rounded on desktop.

### 2. Management shell

- Add `src/web/components/manage/ManageShell.astro` with product identity, Import/Tasks/Security
  navigation, `aria-current`, responsive title, and standard/wide content bounds.
- Use it from the four management routes without moving their authentication, data loading,
  or React state.

### 3. Anonymous library bootstrap

- Add `GET /api/library/management-capability`, returning only
  `{ management_available: boolean }` under the private API policy.
- Request `/api/manage/library` only after a true response.
- Keep `/library` SSR independent of the session.

### 4. Verification and cleanup

- Extend existing tests only where they directly prove the changed behavior.
- Run format, lint, typecheck, focused tests, build, and Playwright viewport/focus/network checks.
- Update the UI audit and run Spec Kit converge.

### 5. Import and task feedback

- Persist the cleaned multipart ZIP display name on the import record in the current clean
  baseline and carry it through private import/job projections.
- Replace the native duplicate filename presentation with one accessible file-selection row.
- Keep accepted-upload context visible while polling and render determinate percentages only
  when a valid total exists.
- Present operation, source/book, translated phase, status, and progress before internal IDs on
  task cards.

## Files

```text
src/styles/reader.css
src/pages/books/[bookKey]/index.astro
src/pages/api/library/management-capability.ts
src/pages/manage/{index,tasks,security}.astro
src/pages/manage/books/[bookId]/preview.astro
src/web/components/library/{BookDetails,AdminLibraryEnhancement}.tsx
src/web/components/manage/ManageShell.astro
src/web/components/import/{ImportUploader,TaskMonitor}.tsx
src/modules/publishing/adapters/{filesystem,sqlite}/
src/platform/sqlite/migrations/0001_clean_slate.sql
```

No complexity exception is required.
