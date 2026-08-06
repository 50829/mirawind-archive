# Implementation Plan: Body Heading Numbering

**Branch**: `main` | **Date**: 2026-08-02 | **Spec**: [spec.md](spec.md)

## Summary

Expose the existing `source | generated | none` book-level numbering policy in the authenticated
publishing workbench. Persist it through the existing ETag-protected immutable config-revision path, and
compile generated numbers only for `body` headings. Keep numbering worker-owned and shared by rendered
HTML, navigation, manifest and search; do not rewrite Markdown or introduce a schema version.

## Technical Context

**Language/Version**: TypeScript 6 on Node.js 24
**Primary Dependencies**: Astro 7, React 19, unified/remark, AJV 8, YAML 2, SQLite via better-sqlite3
**Storage**: SQLite WAL for revision/candidate pointers; local immutable Markdown, `book.yaml` v4 and
candidate artifacts
**Testing**: Vitest 4 unit/contract/integration tests, Testing Library, Playwright 1.61
**Target Platform**: One Linux host with one Astro process and one same-codebase worker
**Project Type**: Server-rendered web application with a background publication compiler
**Performance Goals**: Add no work to reader requests and retain the 300 ms uncached reading target
**Constraints**: Published versions immutable; strict PATCH validation; candidate build off request path;
private management cache/auth policy; Tailwind theme utilities only
**Scale/Scope**: One control and field across one draft endpoint, one structure editor and the shared
heading compiler, with representative four-role and cross-consumer coverage

## Constitution Check

- **Authority & schemas**: Markdown plus `book.yaml` v4 remain authoritative. The mode already exists in
  the strict v4 schema, so D-122 approves a behavior-only change with no migration. HTML, preview,
  manifest and search remain derived and rebuildable.
- **Atomicity & recovery**: PATCH writes a new immutable config revision and queues one candidate under the
  existing transaction. Failed or interrupted builds do not mutate the published current-version pointer.
- **Security boundary**: GET/PATCH remain administrator-only, no-index and private/no-store. The enum is
  bounded input; no content, credential, path or secret is newly logged or exposed.
- **Request-path budget**: Number calculation remains in `build_candidate`; reader requests serve stored
  artifacts. No reader parsing, numbering, rendering or indexing is introduced.
- **Evidence**: Unit fixtures cover all roles, non-H1 starts and prefix parsing; integration tests cover
  strict PATCH, ETag, revision/candidate creation and cross-consumer artifacts; UI tests cover dirty,
  discard and conflict retention.
- **Simplicity**: No service, database, queue, process, library, schema version or independent numbering
  implementation is added. **Result: PASS.**

## Project Structure

```text
src/
├── modules/publishing/
│   ├── core/preparation/heading-title.ts
│   ├── core/publication/heading-presentation.ts
│   └── adapters/filesystem/config-revisions.ts
├── pages/api/manage/books/[bookId]/draft.ts
└── web/
    ├── components/manage/StructureEditor.tsx
    ├── components/manage/PublishingWorkbench.tsx
    └── contracts/publishing.ts

tests/
├── integration/compiler/pages-manifest.test.ts
├── integration/publication/config-revisions.test.ts
├── unit/compiler/structure-proposal.test.ts
└── unit/library/structure-editor-state.test.ts
```

**Structure Decision**: Extend the established publishing core, filesystem adapter and React management
surface. API pages remain thin composition entrypoints; consumer-visible numbering remains a core compiled
presentation.

## Design

1. Extend the draft contract and GET projection with `numbering`, then allow exactly the three enum values
   in PATCH and replace only `publishing.numbering.mode` in the next validated config revision.
2. Add numbering to the editor's local/server/accepted snapshots. A labeled three-button segmented control
   participates in dirty detection, save payload, discard, accepted-save merge and stale-ETag retention.
3. Change generated numbering to skip every non-body role. Treat the first body heading's configured level
   as the current top level so a body beginning below H1 starts at `1`; if a later body heading is shallower,
   rebase it as the next top-level item while retaining the positive top counter.
4. Tighten source-prefix separation: decimal forms adjacent to CJK/letters are title content unless a safe
   separator exists, and raw rich Markdown strips only the visible prefix supported by the parsed evidence.
5. Verify that body HTML, TOC, outline, breadcrumb/page metadata, manifest and search continue taking the
   single compiled `number/title/label` result.

## Post-Design Constitution Check

The design adds one validated scalar to existing boundaries and changes one pure compiler calculation.
It preserves all pre-design authority, atomicity, security and request-path conclusions. **Result: PASS.**

## Complexity Tracking

No constitution violations or additional infrastructure.
