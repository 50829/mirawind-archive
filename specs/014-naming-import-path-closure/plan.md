# Implementation Plan: Naming, Import, and Path Closure

**Branch**: `main` | **Date**: 2026-08-24 | **Spec**: [spec.md](spec.md)

**Input**: Give current runtime concepts semantic names, use local imports inside ownership
packages, remove superseded parsers, harden canonical filesystem boundaries, and verify all
primary workflows in both requested browsers.

## Summary

Replace the repository-wide root-alias-only convention with a target-aware canonical import rule:
relative imports within one ownership package and `@/` imports across packages, with business-module
crossings restricted to semantically named application APIs. Rename the four module facades, the
worker-child handler contract, the MinerU reference tooling, and current printed-contents analysis
APIs without changing strict persisted identities. Delete the obsolete non-TSV PDF parser. Split the
filesystem utility container into storage-layout, canonical-path and atomic-file primitives; enforce
canonical POSIX paths, bounded archive collision checks, ZIP inspection/extraction identity equality,
symlink-safe layout roots, and failed-write cleanup. Preserve worker, publication, response and schema
behavior, then exercise the built application with both Browser and Chrome.

## Technical Context

**Language/Version**: TypeScript 6.0 in strictest mode on Node.js 24.x

**Primary Dependencies**: Astro 7.1, React 19.2, TypeScript compiler API, zip.js, Node filesystem
primitives, existing unified/remark/rehype, SQLite and worker stack

**Storage**: SQLite WAL plus private local upload, staging, draft and immutable version directories;
no schema or data-format change

**Testing**: Vitest architecture/unit/contract/integration projects, Playwright E2E, reference-v2
comparison, existing performance gates, and interactive Browser plus Chrome inspection

**Target Platform**: One Linux host, one Astro Web process and one same-codebase worker process

**Project Type**: Server-rendered modular monolith with an isolated background publishing compiler

**Performance Goals**: Public read p95 at most 300 ms; representative build wall and process-tree
RSS remain within `max(5%, 1 s)` and `max(5%, 64 MiB)` regression tolerances

**Constraints**: One globally running job, at most four rendered pages in flight, hostile ZIP limits,
strict book/manifest/version/health/reference formats, no compatibility wrapper or second runtime path

**Scale/Scope**: Approximately 284 product source files, 226 files currently using internal root
aliases, four business-module facades, 20,000 archive entries, fifteen private reference books, one
500-page stress book, and the library/manage/publishing/reader browser journeys

## Constitution Check

### Pre-Design Gate

- **Authority & schemas - PASS**: Markdown and `book.yaml` v4 remain authoritative. Manifest v3,
  version marker v3, worker health v2 and reference v2 remain strictly validated. Renaming first-party
  APIs does not rename stored fields or identities and requires no migration.
- **Atomicity & recovery - PASS**: Publication transactions and immutable versions are unchanged.
  Failed extraction still removes its fresh destination; failed atomic writes preserve the previous
  target and now remove the temporary file. No recovery path publishes a candidate.
- **Security boundary - PASS**: The work narrows hostile path acceptance and storage-root behavior.
  It introduces no response or logging data. Browser verification covers existing authorization,
  no-store management responses and private-resource behavior without weakening them.
- **Request-path budget - PASS**: Import canonicalization and name checks are build-time gates. ZIP
  checks run in the bounded worker. Reader requests gain no parsing, rendering or filesystem scans.
- **Evidence - PASS**: Architecture fixtures cover both legal and illegal import spellings; path
  fixtures cover normalization, case folding, drive ambiguity, symlinks, changed ZIP identity and
  write cleanup. Full reference, E2E and performance gates remain required.
- **Simplicity - PASS**: The design reuses TypeScript resolution, Node filesystem primitives, zip.js,
  existing tests and the two requested browser surfaces. It adds no service, package workspace,
  database, migration, queue or runtime abstraction layer.

### Post-Design Gate

- The import contract is target-aware and cannot bypass existing layer/module checks.
- First-party runtime names are semantic while stored/external versions remain explicit.
- Path checks are deterministic and bounded; archive prefix checks are constant-time per prefix
  rather than scanning all registered paths.
- Storage roots are canonical directories; internal relative paths have one POSIX representation;
  archive identity is rechecked before any entry writes.
- Worker claim, child process, page concurrency, health/RSS/stage observation and publication
  transactions are unchanged.
- No constitutional violation or complexity exception is required. **Result: PASS.**

## Project Structure

### Documentation (this feature)

```text
specs/014-naming-import-path-closure/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
scripts/architecture/
├── boundaries.ts
├── canonical-imports.ts
├── dependency-graph.ts
└── semantic-names.ts

src/
├── composition/
│   └── worker-child/job-handler.ts
├── modules/
│   ├── catalog/application/catalog-api.ts
│   ├── identity/application/identity-api.ts
│   ├── publishing/application/publishing-api.ts
│   ├── publishing/core/preparation/printed-contents-analysis.ts
│   └── reader/application/reader-api.ts
├── platform/filesystem/
│   ├── atomic-file.ts
│   ├── contained-path.ts
│   └── storage-layout.ts
└── remaining ownership packages using target-aware canonical imports

scripts/fixtures/
└── mineru-reference.ts

tests/
├── architecture/
├── fixtures/architecture/
├── integration/{archive,storage,recovery}/
├── unit/{compiler,fixtures}/
└── e2e/
```

**Structure Decision**: Preserve the existing modular monolith. A source package is one business
module (`src/modules/<domain>/`) or one top-level ownership tree (`composition`, `config`, `domain`,
`entrypoints`, `http`, `observability`, `pages`, `platform`, `styles`, `web`). Imports inside that
package are relative; imports across packages use `@/`. Cross-business-module and entrypoint rules
still require the target's named application API. The filesystem split extracts existing primitives
and does not introduce another application layer. Direct files below `src/` belong to a `src-root`
package. The `@/schemas/*` TypeScript path maps to authoritative `docs/schemas/` data and remains an
explicit non-product-tree exception. Tests and scripts keep relative imports within their support
trees and are not bulk-rewritten by the product canonicalizer.

## Delivery Phases

1. Add the target-aware import and semantic-name gates with failing fixtures.
2. Rename module APIs, current analysis/reference APIs and handler contracts; delete old exports.
3. Canonicalize all product imports and update architecture documentation.
4. Add path-boundary failures, then split and harden filesystem/archive primitives.
5. Run focused and full automated gates, then verify desktop/mobile workflows in Browser and Chrome.
6. Converge specs, tasks, tests and evidence; commit each coherent phase.

## Complexity Tracking

No constitution violations or additional infrastructure are required.
