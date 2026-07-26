# Implementation Plan: Clean-slate Publishing and Reading

**Branch**: `006-clean-slate-publishing` | **Date**: 2026-07-26 | **Spec**:
[spec.md](./spec.md)

**Input**: Feature specification from
`/specs/006-clean-slate-publishing/spec.md`

## Summary

Replace upload, import processing, the publishing workbench, draft preview, publication and
reading as one delivery. The implementation uses one strict current format family, one
background compilation path and one `ReaderPageModel`/`ReaderShell` for preview and
published pages. Preview pages run in an opaque sandbox with session-bound resource
authorizations. Structure edits are incremental, conflict-detectable and rebuild a
revision-pinned preview before publication becomes available.

## Technical Context

**Language/Version**: TypeScript 6 on Node.js 24

**Primary Dependencies**: Astro 7, React 19, better-sqlite3, Tailwind CSS 4,
`@tanstack/react-virtual`, lucide-react, KaTeX 0.18.1, zip.js and Busboy

**Storage**: SQLite WAL plus contained local persistent storage

**Testing**: Vitest contract/unit/integration tests, Playwright browser tests, fixture
benchmarks, lint, typecheck and production build

**Target Platform**: one Linux host with one Astro Web process and one same-codebase worker

**Project Type**: server-rendered Web application with private React management islands and
a durable background worker

**Performance Goals**: uncached public reading p95 at most 300 ms; bounded DOM work for
2,000 and 20,000 item structures; browser job polling once per second

**Constraints**: 2 GiB ZIP, 8 GiB extraction, 20,000 archive entries, 30-minute background
limit, one active background child, immutable publication, no reader-request compilation,
opaque preview sandbox and no new service or realtime transport

**Scale/Scope**: 97/441/583-page private MinerU 3.4.4 fixtures, one 500-page synthetic
fixture, structures from 20 through 20,000 items, one administrator

## Constitution Check

_GATE before Phase 0: PASS. Re-check after Phase 1: PASS._

- **Authority & schemas**: normalized Markdown and strict `book.yaml` v3 are authoritative.
  Document manifest v2, version marker v2, preview pages, HTML, resources and search data
  are derived. Constitution 2.0 and D-108 authorize the clean switch; the single consolidated
  database baseline and strict format rejection provide its tested transition boundary.
- **Atomicity & recovery**: accepted configuration creates an immutable revision and queued
  preview in one controlled transition. Publication builds and verifies files/search before
  the short transaction changes `current_version_id`. Failures preserve the prior current
  version. Feature 005 deletion barriers remain effective.
- **Security boundary**: ZIP input is streamed and treated as hostile. Every management
  response is authenticated and non-cacheable. Preview pages require the administrator
  session; each opaque-sandbox book resource carries a one-hour authorization bound to the
  active session, book, revision and resource. Invalid, stale, logged-out and deleted
  requests return the hidden 404 policy.
- **Request-path budget**: parsing, typography, resource inspection, semantic rendering,
  KaTeX and indexing remain in the worker child. Reader requests serve immutable files and
  bounded database projections only.
- **Evidence**: archive limits and cleanup, strict formats, closed job phases, cancellation,
  resource authorization, preview/publish parity, crash boundaries, formula fallback,
  structure virtualization, responsive accessibility and real/stress fixtures all have
  named automated evidence.
- **Simplicity**: the existing Web process, worker, SQLite queue and filesystem remain.
  XHR is used only for byte progress; polling remains HTTP. No client router, global state
  library, SSE, WebSocket, Redis or additional service is added.

## Design

### Clean switch and formats

The runtime exposes only the current publishing path. Database construction is represented
by `0001_clean_slate.sql`. Book configuration, document manifest and version markers each
have one strict current schema. Compiler, renderer, preview builder and reader assets use
one current identity and do not branch by legacy format.

### Upload and progress

The browser sends one ZIP with XHR, retaining its idempotency key across network retry.
Transfer completion and server acceptance are distinct states. Caddy limits only the import
POST slightly above the ZIP allowance for multipart overhead; the application streams the
actual file field and enforces the exact ZIP limit. Worker child progress is closed by job
kind and emitted on phase change or after 250 ms; management polling is once per second.

### Shared reader and private preview

Preview and publication compile a single `ReaderPageModel` into `ReaderShell`. The same
versioned external runtime handles navigation, drawers, search and preview messaging, so
generated pages contain no inline script. Preview iframes use `sandbox="allow-scripts"`.
They emit only ready, location and navigation messages; the parent validates the source
window, revision, page and fragment before acting.

The page route injects resource authorizations only into generated preview resource URLs.
The resource route verifies the signature, live administrator session, current ready
revision and contained file. Preview pages and resources remain private/no-store and use
no-referrer. Reader CSS/runtime and KaTeX assets are public immutable assets with the
cross-origin response policy required by an opaque sandbox.

### Publishing workbench

The desktop workbench has a persistent action bar, virtualized searchable structure tree,
selected-node editor and sticky real-reader iframe. PATCH requests identify blocks and
source regions, require the current ETag, merge into authoritative v3 configuration and
queue a preview. Conflict never discards local state. An accepted save blocks a second save
until the corresponding preview is ready; later edits remain dirty. Diagnostics filter by
severity/page and locate the structure node and iframe fragment.

### Formula and reading behavior

KaTeX emits one `.katex` containing one MathML and one HTML representation. A minimal
embedded visually-hidden rule keeps MathML from becoming a second visual formula when the
complete versioned KaTeX stylesheet fails. Reader headings, skip navigation, focus, target
size and local overflow behavior are shared by preview and publication.

## Project Structure

### Documentation

```text
specs/006-clean-slate-publishing/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── formats.md
│   ├── manage-api.md
│   └── preview-protocol.md
├── checklists/
└── tasks.md
```

### Source Code

```text
src/
├── compiler/
├── components/
│   ├── import/
│   ├── preview/
│   └── reader/
├── db/
│   ├── migrations/0001_clean_slate.sql
│   └── repositories/
├── http/
│   ├── authorization/
│   ├── cache/
│   └── multipart/
├── jobs/handlers/
├── pages/
│   ├── api/manage/
│   ├── manage/
│   └── read/
├── services/
├── styles/
└── worker/

tests/
├── contract/
├── unit/
├── integration/
└── e2e/
```

**Structure Decision**: extend the existing same-codebase Web/worker layout. SSR owns
authorization and page shells; React islands own upload and workbench interaction; all
compilation remains in worker handlers; shared reader code lives under `components/reader`.

## Complexity Tracking

No constitution violation or new architectural component requires an exception.
