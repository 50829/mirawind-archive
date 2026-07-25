# Implementation Plan: Library and Reading Loop

**Branch**: `[003-library-reading-loop]` | **Date**: 2026-07-25 | **Spec**:
[spec.md](./spec.md)

**Input**: Feature specification from
`/specs/003-library-reading-loop/spec.md`

## Summary

Complete the user-facing route from `/library` to version-consistent book details and the
existing reader, then connect a successful publish job back to those public surfaces.
Public discovery and details remain server-rendered and byte-identical for anonymous and
administrator sessions. Administrator-only entries arrive through a private enhancement
API. A new version-scoped SQLite presentation projection prevents draft metadata and alias
changes from leaking into the current published version while keeping every request bounded
and free of source parsing.

## Technical Context

**Language/Version**: TypeScript 6 on Node.js 24; Astro 7 server routes; React 19 static
markup and focused client islands; SQL migration 6

**Primary Dependencies**: Existing Astro Node adapter, React, better-auth sessions,
better-sqlite3, native HTML dialog/history APIs and existing response-policy utilities;
`axe-core` becomes a direct test dependency but no runtime framework is added

**Storage**: Existing SQLite WAL and immutable local version directories; new
`book_version_presentations` derived table keyed by immutable `version_id`; no change to
`book.yaml`, `document-manifest.json` or `version.json` v1

**Testing**: Vitest unit/integration/contract projects; Playwright desktop, 360-pixel mobile
and no-JavaScript journeys; accessibility scans; migration/recovery fixtures; a bounded
1,000-book library benchmark during a background rebuild

**Target Platform**: Existing single Linux host and local Docker preview; current evergreen
desktop and mobile browsers with a semantic no-JavaScript fallback

**Project Type**: Same-codebase Astro Web application, compiler and worker

**Performance Goals**: Uncached `/library` and direct public details HTML at or below 300 ms
p95 with 1,000 current books while one background rebuild runs; details and administrator
API payloads have explicit entry and byte limits

**Constraints**: One Web and one worker; SQLite remains the sole database; public HTML must
not vary by session; no YAML/Markdown/content parsing on reader requests; every public query
filters `public + current_version_id + published + reclaimed_at IS NULL`; immutable versions
are never edited; existing superseded-resource semantics remain intact

**Scale/Scope**: One administrator; root library only; up to 1,000 current library entries,
200 details TOC preview entries, 100 authors/contributors and the existing 20,000-page book
limit; no nested-folder editing in this slice

## Constitution Check

_GATE: Passed before Phase 0 research and passed again after Phase 1 design._

- **Authority & schemas — PASS**: Markdown and versioned `book.yaml` remain authoritative.
  The projection is a versioned, strictly validated, rebuildable SQLite representation of
  frozen `book.yaml` plus manifest fields. D-099 authorizes migration 6, fixtures, background
  backfill and compatibility behavior. Portable schemas remain v1.
- **Atomicity & recovery — PASS**: A new projection is registered with its `ready` version
  and search rows in one immediate transaction. Final publication verifies the projection
  and promotes its alias with `current_version_id` in the existing cutover transaction.
  Missing projections never cause draft fallback; worker reconciliation repairs them before
  rollback candidates are used.
- **Security boundary — PASS**: D-100 separates cacheable public SSR from authenticated
  `private, no-store` management data. Library, details, reader, JSON, cover, download,
  redirect, 404 and 503 classes have explicit authorization, cache and indexing contracts.
  Conditional requests run only after current authorization.
- **Request-path budget — PASS**: Library reads use one bounded SQLite query and details use
  one version projection plus bounded originals. HTTP never reads `book.yaml` or parses a
  complete manifest for these new surfaces. The existing reader keeps pre-generated HTML.
  Reconciliation and projection generation run in the worker/build path.
- **Evidence — PASS**: Migration, backfill, stale draft, alias conflict, projection/FTS
  rollback, visibility transition, corrupt-current, cache matrix, no-JavaScript, mobile,
  accessibility and 1,000-book concurrent-build performance evidence are required.
- **Simplicity — PASS**: One derived table, two page routes, two JSON endpoints and focused
  native-dialog scripts extend the existing monolith. No service, database, queue, router
  framework or global mutable library manifest is introduced.

## Project Structure

### Documentation

```text
specs/003-library-reading-loop/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── http.md
│   └── interaction.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code

```text
src/
├── components/
│   ├── library/
│   │   ├── LibraryScene.tsx
│   │   ├── BookCard.tsx
│   │   ├── BookDetails.tsx
│   │   └── AdminLibraryEnhancement.tsx
│   ├── preview/PublishPanel.tsx
│   └── reader/
│       ├── BookSearch.tsx
│       ├── ReaderShell.tsx
│       └── render.ts
├── db/
│   ├── migrations/0006_book_version_presentations.sql
│   ├── repositories/book-presentations.ts
│   └── migration-manifest.ts
├── http/cache/
│   ├── policies.ts
│   └── library-response.ts
├── pages/
│   ├── library/index.astro
│   ├── books/[bookKey]/index.astro
│   ├── api/books/[bookKey]/details.ts
│   └── api/manage/library.ts
├── services/
│   ├── book-presentation.ts
│   ├── library.ts
│   └── published-book.ts
├── storage/reconcile.ts
└── compiler/version-builder.ts

tests/
├── contract/library-reading.contract.test.ts
├── integration/
│   ├── library/
│   ├── publication/
│   ├── recovery/
│   └── storage/migrations.test.ts
├── unit/library/
└── e2e/library-reading.spec.ts

scripts/benchmarks/library.ts
docs/
├── architecture/m1-architecture.md
├── decisions/decision-log.md
├── operations/deployment.md
└── product/product-spec.md
```

**Structure Decision**: Keep page composition, data access, build/reconciliation and tests
inside their existing repository layers. Library React renders semantic SSR and adds only
small optional interactions; it does not become a separate frontend application.

## Complexity Tracking

No constitution violation or additional architecture layer is introduced.
