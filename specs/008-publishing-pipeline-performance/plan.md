# Implementation Plan: Publishing Pipeline Performance

**Branch**: `008-publishing-pipeline-performance` | **Date**: 2026-07-30 | **Spec**: [spec.md](spec.md)

**Input**: Replace the duplicate preview/publication build paths with one recoverable candidate,
make business-module dependencies enforceable, and improve the measured fifteen-book pipeline
without changing reference v2 output or reader behavior.

## Summary

Restructure the monolith around `modules/<domain>/{core,application,adapters}`, with Astro,
worker and CLI kept as entrypoints and composition roots as the only adapter assembly points.
Publishing core exposes only `BuildCandidateCommand`, `CompiledBook`, an ordered
`AsyncIterable<RenderedPage>` execution protocol, and `CandidateBuildArtifact`; internal byte,
block, range and page indexes remain implementation details. Linearize the measured source,
typography and pagination hotspots, then cleanly replace `build_preview` and `build_publish` with
one `build_candidate` job whose ready immutable output is synchronously promoted. Prove the
change with architecture fixtures, crash boundaries, fifteen reference-exact books and paired
performance runs against `93e01432`, the pre-optimization baseline with the nested-role correctness
fix and its validator contract backported onto `c176fdd`.

## Technical Context

**Language/Version**: TypeScript 6.0 in strictest mode on Node.js 24.x

**Primary Dependencies**: Astro 7.1, React 19.2, unified/remark/rehype, KaTeX 0.18.1, Shiki 4.3,
Sharp 0.35, better-sqlite3 12.11, zip.js 2.8, Ajv 8.20

**Storage**: SQLite WAL with the single clean-slate `0001` baseline and private local filesystem
staging/source/version trees

**Testing**: Vitest unit/contract/integration projects, Playwright E2E, fixture comparators,
microbenchmarks and paired real-book benchmark runners

**Target Platform**: One Linux host, one Astro Web process, one same-codebase worker process

**Project Type**: Server-rendered monolithic web application with an isolated background compiler

**Performance Goals**: Fifteen-book paired median wall total at least 30% lower; slowest five at
least 35% lower; accepted-to-preview at least 25% lower; publish-to-public at least 90% lower;
fourfold source-region input below sixfold runtime; reader p95 at most 300 ms and search p95 below
1,000 ms during at least 200 overlapping requests

**Constraints**: Fifteen out of fifteen reference v2 exact every round; no book regression above
`max(5%, 1 s)`; RSS increase no greater than `max(5%, 64 MiB)`; at most four rendered pages in
flight; 30-minute job timeout and 10-second cancellation grace; no request-path parsing/rendering;
no legacy runtime branch after candidate cutover

**Scale/Scope**: Fifteen MinerU 3.4.4 books from 97 to 1,278 PDF pages, 500-page synthetic stress
book, up to 20,000 archive entries, 256 MiB Markdown and 2 GiB uploads

## Constitution Check

### Pre-Design Gate

- **Authority & schemas - PASS**: normalized Markdown plus `book.yaml` v3 remain authoritative.
  Manifest v2, version marker v2, HTML, search and presentation remain derived. The single database
  baseline is revised for candidate lifecycle and the worker protocol and public compiler identities
  advance together; no portable publishing schema changes.
- **Atomicity & recovery - PASS**: candidate files are fully written, synced and renamed before one
  registration transaction records version, search, presentation, preview readiness and job success.
  A separate short transaction validates and promotes the same candidate. Every pre/post rename and
  pre/post commit interruption has an orphan or terminal-state rule.
- **Security boundary - PASS**: hostile ZIP and image limits, child-process isolation, authenticated
  preview resources, hidden private 404s and private storage remain unchanged. The child result is
  bounded and contains no body content or raw unsafe paths.
- **Request-path budget - PASS**: draft PATCH performs bounded structural validation only;
  compile/render/search run in `build_candidate`. Reader routes load immutable indexes and files.
  Rendering is bounded to four in-flight pages and background work must retain reader/search SLOs.
- **Evidence - PASS**: architecture negative fixtures, complexity microbenchmarks, fifteen local
  reference fixtures, hostile archives/images, crash injection, cancellation, parity, concurrent
  reader/search and 500-page stress evidence are all required.
- **Simplicity - PASS**: no new service, database, queue, deployment unit, package workspace, client
  router or state library. `AsyncIterable` supplies backpressure without adding infrastructure.

### Post-Design Gate

- Authority remains only Markdown and `book.yaml`; `CompiledBook` is ephemeral and the candidate is
  derived and rebuildable.
- `DraftCandidate` and `BookVersion` are persistence lifecycle records, not extra editable content.
- The design uses two explicit SQLite transactions separated by durable filesystem finalization;
  no transaction spans page rendering or filesystem traversal.
- All HTTP contracts retain explicit authentication, authorization, cache and indexing policy.
- No constitutional violation or complexity exception is required.

## Project Structure

### Documentation

```text
specs/008-publishing-pipeline-performance/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── architecture-boundaries.md
│   ├── http-api.md
│   ├── publishing-core.md
│   └── worker-protocol.md
├── checklists/
└── tasks.md
```

### Source Code

```text
src/
├── modules/
│   ├── publishing/
│   │   ├── core/
│   │   │   ├── preparation/
│   │   │   └── publication/
│   │   ├── application/
│   │   │   ├── commands/
│   │   │   ├── queries/
│   │   │   ├── ports/
│   │   │   └── public.ts
│   │   └── adapters/
│   │       ├── filesystem/
│   │       ├── reader-html/
│   │       └── sqlite/
│   ├── reader/
│   │   ├── core/
│   │   ├── application/
│   │   └── adapters/
│   ├── catalog/
│   │   ├── core/
│   │   ├── application/
│   │   └── adapters/
│   └── identity/
│       ├── core/
│       ├── application/
│       └── adapters/
├── entrypoints/
│   ├── cli/
│   └── worker/
├── composition/
│   ├── cli.ts
│   ├── server.ts
│   └── worker.ts
├── platform/
│   ├── filesystem/
│   ├── process/
│   └── sqlite/
├── web/
│   ├── components/
│   ├── contracts/
│   ├── controllers/
│   ├── features/reader/
│   └── presenters/
└── pages/

tests/
├── architecture/
├── contract/
├── integration/
├── unit/
└── e2e/

scripts/
├── architecture/
└── benchmarks/
```

**Structure Decision**: top-level organization follows business modules. Each module has one
dependency rule: adapters and entrypoints depend inward on application/core, never the reverse.
Publishing core has only the stable `preparation` and `publication` responsibilities, avoiding a
directory and public type for every pipeline verb. Astro `src/pages` remains the server entrypoint;
there is no duplicate server-route tree. Reader presentation stays in `web/features/reader`, while
reader authorization and immutable artifact lookup live in the reader module. Platform contains no
book, candidate, version, user or route concepts.

## Delivery Phases

### Phase A - Reproducible Baseline and Boundaries

Add environment/commit/fixture binding, AB/BA/AB orchestration, per-stage/RSS output, statistical
validation, algorithm complexity fixtures and architecture negative fixtures. Configure TypeScript,
worker output and test tooling so all product imports can use `@/`. Add AST-based import graph checks
for aliases, cycles, reverse dependencies, module public surfaces and high-coupling thresholds.

### Phase B - Behavior-Preserving Module Migration

Create module public surfaces and composition roots, then move leaf core logic and DTOs before
application orchestration and adapters. Replace nullable job inputs with discriminated commands.
Move business SQL and paths into module adapters, leaving only primitives in platform. Keep output
byte/semantic equivalent and commit this independently from algorithm changes.

### Phase C - Linear Content Processing

Build UTF-8 byte offsets, block/heading/range/page maps and prefix accumulators once inside
`compileBook()`. Apply typography edits with one builder pass; replace source-region, pagination,
outline and resource rescans with indexed traversal. Preserve diagnostic ordering, byte ranges,
stable IDs and all fifteen references. Add cancellation probes to long loops.

### Phase D - Candidate Clean Switch

Revise the single database baseline, job kind, worker protocol, application commands, HTTP contract
and workbench DTO together. Remove `build_preview` and `build_publish`; add `build_candidate`.
Compile one `CompiledBook`, stream `RenderedPage` with at most four pages in flight, materialize both
ReaderShell policies, and return one bounded `CandidateBuildArtifact`. Register ready state atomically,
then synchronously promote that exact candidate. Delete old handlers, identities, preview authority,
version builder and forwarding exports in the same cutover.

### Phase E - Reader and I/O Optimization

Use one file inventory through candidate assembly: record hashes from generated bytes, hashed source
copies or strictly validated frozen original metadata, build the marker from that bounded
adapter-local state, then retain one independent whole-tree hash validation before fsync and rename.
Retain only the normalized main Markdown and its already-resolved resource closure in each immutable
draft source snapshot; keep the original ZIP separately as the reprocess input and discard MinerU
sidecars and unreferenced files. Hand the bounded resource-path list from the prepare child to the
parent through its short-lived staging tree so finalization does not parse the document again.
Add immutable manifest single-flight
plus O(1) page/resource lookup, and stream preview resources from validated metadata. A successful
import analysis atomically seals its validated extraction under that import;
draft preparation claims it once, while missing/invalid handoffs re-extract normally and terminal
cleanup removes only the derived tree. Archive validation is unchanged.

### Phase F - Evidence and Convergence

Run format, lint, architecture, typecheck, unit, contract, integration, E2E, build, hostile input,
recovery, synthetic stress, fifteen-book exact and paired benchmarks. Update the performance report
from machine-readable evidence, remove obsolete directories/files, run Spec Kit analyze and converge,
and require zero unmitigated CRITICAL findings before completion.

## Commit Boundaries

1. `docs(publishing): specify candidate architecture and performance gates`
2. `test(benchmarks): make publishing comparisons reproducible`
3. `refactor(architecture): establish acyclic module boundaries`
4. `perf(publishing): linearize document compilation indexes`
5. `refactor(publishing)!: switch to immutable candidate builds`
6. `perf(reader): bound artifact loading and candidate io`
7. `test(publishing): close recovery and performance gates`

The candidate schema/job/API/UI replacement is one clean-switch commit. Mechanical moves, algorithm
changes and performance evidence remain separate so regressions can be localized. Each commit must
pass its applicable tests and Conventional Commit validation.

## Complexity Tracking

No constitution violations are planned.
