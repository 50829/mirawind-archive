# Implementation Plan: MinerU Public Publishing

**Branch**: `[001-mineru-public-publishing]` | **Date**: 2026-07-25 | **Status**:
Implemented and verified | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from
`/specs/001-mineru-public-publishing/spec.md`

## Summary

Deliver the first complete MinerU publishing slice on one Linux host: the sole administrator
authenticates, streams one hostile ZIP into durable storage, confirms the detected document
and publishing structure, and starts a bounded background build. A same-codebase worker
produces a complete immutable version, validates semantic HTML, resources, manifest and
version-scoped search data, then atomically changes SQLite's sole current-version pointer.
Anonymous readers always consume pre-generated current-version artifacts, can search Chinese
and mixed-language text, and can resume a controlled download of the registered original ZIP.

The implementation is a single TypeScript project with an Astro Node Web process, React
Islands for management interactions, one worker process plus a per-job child process,
SQLite/WAL and a local persistent filesystem. It uses maintained components for
authentication, archive parsing, Markdown processing, sanitization, KaTeX, highlighting,
schema validation and image metadata. No reader request performs compilation work.

## Technical Context

**Language/Version**: TypeScript in strict mode on Node.js 24 LTS; exact package versions are
locked in the repository and deployment image

**Primary Dependencies**: Astro 7 with the official Node adapter and React integration;
Better Auth with the Passkey plugin and `better-sqlite3`; `@zip.js/zip.js`;
unified/remark/rehype with an explicit sanitization schema; KaTeX; Shiki with class-based
style output; Sharp/libvips; Ajv and a strict YAML parser; Pino

**Development Governance**: Conventional Commits 1.0.0 enforced by commitlint in the
repository-managed commit hook and pull-request CI; an immutable source/license ledger for
substantive external code copies or adaptations; no automatic release tooling in M1

**Storage**: One SQLite database in WAL mode (runtime SQLite 3.51.3 or newer) plus one
same-filesystem persistent data root; direct reviewed SQL migrations and a narrow repository
layer; no ORM-generated business schema, Redis, external queue, object storage or second
database

**Testing**: Vitest for unit/component/integration tests, Playwright for browser journeys,
fixture builders for hostile ZIPs and crash points, and an isolated benchmark harness for
read/search/build measurements

**Target Platform**: Single x86-64 or arm64 Linux host, containerized with Docker Compose,
behind Caddy or an equivalent HTTPS reverse proxy; exactly one Web process and one worker
process

**Project Type**: Server-rendered Web application, background compiler/worker and offline
administrator CLI from one codebase

**Performance Goals**: Uncached-origin public reading page p95 at or below 300 ms; supported
search p95 below 1 s on the representative large-book fixture; current publication remains
responsive throughout a background build

**Constraints**: 2 GiB upload, 8 GiB actual extraction, 20,000 archive entries, 2 GiB per
entry, 256 MiB main Markdown, 100,000,000 pixels and 32,768 pixels per image side, path depth
20, component length 255 UTF-8 bytes, relative path length 2,048 UTF-8 bytes, 30-minute job
limit, 10-second cooperative termination grace, and 200:1 entry/package expansion limit
after 64 MiB; one active import/build globally; 10-second heartbeat and 60-second lease
expiry; fallback passwords 16–128 characters and sensitive Passkey operations require a
server-fresh session no older than five minutes

**Scale/Scope**: One administrator and one host; M1 covers one-book MinerU ZIP import,
structure confirmation, draft preview, immutable publication, current-book search, public
reading and original ZIP download. EPUB, complete library/folder UI, notes, highlights,
reading state, body reordering and page-alias editing are excluded.

## Constitution Check

_GATE: Passed before Phase 0 research and passed again after Phase 1 design._

- **Authority & schemas — PASS**: Imported Markdown, registered originals and versioned
  `book.yaml` are authoritative. Draft source snapshots and config revisions are durable;
  ASTs are transient. HTML, `document-manifest.json`, resource variants and FTS rows are
  derived. `book.yaml` and manifest retain independent integer schema versions, strict JSON
  Schema validation, explicit stepwise migrations and rejection of unsupported newer
  versions.
- **Atomicity & recovery — PASS**: A worker builds under same-filesystem staging, fsyncs and
  atomically renames a complete version, commits its version-scoped search data, and only
  then updates `books.current_version_id` in a guarded `BEGIN IMMEDIATE` transaction.
  Captured config/source/current-version values reject stale jobs. Startup reconciliation
  cleans incomplete staging, quarantines orphans, verifies current versions and rolls one
  affected book back to its newest verified predecessor without publishing `ready` work.
- **SQLite durability — PASS**: Startup rejects linked SQLite older than 3.51.3 or missing
  WAL/FTS5 capability. Connections use `synchronous=FULL`, short transactions and explicit
  busy bounds. The worker owns passive checkpoints so a public Web request does not inherit
  checkpoint fsync work.
- **Security boundary — PASS**: Better Auth provides database sessions, password hashing and
  WebAuthn/Passkeys. Every HTML, preview, resource, search, job and download route authorizes
  server-side before ETag or Range handling. Private content is outside public static roots.
  Streaming archive validation rejects traversal, normalized collisions, links, special
  files, encryption and resource-limit violations. Logs contain opaque IDs and safe error
  categories, not credentials, private body text or unsafe raw paths.
- **Request-path budget — PASS**: ZIP extraction, Markdown/AST work, KaTeX, highlighting,
  image processing, manifest creation and indexing run only in a terminable job child
  process. Reader requests resolve one current version and read pre-generated files. The
  300 ms p95 read target, 1 s search p95 target and all approved byte/count/time/concurrency
  budgets are explicit test gates.
- **Evidence — PASS**: Tests use real representative Cloud/CLI MinerU output; generic,
  ambiguous and multi-book packages; missing-resource and unsafe-HTML cases; generated
  traversal, link, malformed, duplicate, bomb, image, size/count/path and timeout archives;
  Chinese/mixed-language queries; crash injection around rename, FTS and pointer commits;
  and a large stress book. Schema migration, authorization, cache, Range, recovery,
  reproducibility and performance evidence are mandatory.
- **Real fixture handoff — PASS**: The administrator supplied and approved 583-page and
  441-page representative real books plus one 97-page real compatibility book from MinerU
  3.4.4. Final acceptance runs all three plus one 500-page synthetic stress book. Git stores
  only non-content fixture instructions; the ignored local manifest uses opaque IDs,
  version, page range, size and SHA-256. Ordinary CI reports an explicit skip when real
  samples are absent, while the synthetic book remains its repeatable stress baseline and
  final compatibility and performance gates require every registered sample.
- **History & provenance — PASS**: Repository commits use Conventional Commits with local and
  CI validation. Substantive external code reuse records an immutable source revision,
  source path, license and local modifications; GPL, MPL and custom-licensed application
  code remains pattern-only unless a later explicit decision approves reuse.
- **Simplicity — PASS**: The plan uses exactly the constitutional baseline: one Web process,
  one same-codebase worker, one per-job child for bounded termination, SQLite and local
  files. SQLite is also the durable queue. Direct SQL is preferred because FTS5 virtual
  tables, explicit transaction modes and Better Auth migrations require reviewable SQL;
  this does not add an infrastructure layer.

## Phase 0: Research Decisions

The resolved implementation decisions, evidence and rejected alternatives are recorded in
[research.md](./research.md). The implementation MUST use the repository lockfile and image
digest rather than floating tags or `@latest`; supported runtime/library versions are
rechecked when implementation starts and on dependency upgrades.

Existing-project and commit-convention research is recorded in
`docs/research/existing-implementations-and-commit-conventions.md`. Implementation MUST
prefer maintained narrow dependencies, then selectively port small compatible-licensed
components, and use complete applications only for behavior and test-pattern comparison.
MinerU-HTML is the first code-level reference for MinerU Markdown/image/page conventions,
but its regex TOC, process-memory search, and position-based IDs do not replace the
specified AST, SQLite FTS5, or stable-block architecture. Every substantive port is entered
in `docs/third-party/code-provenance.md` before merge.

## Phase 1: Design

### Authoritative and derived storage

The persistent book root separates durable editable authority from disposable build state:

```text
data/
├── db/mirawind.sqlite
├── books/<book_id>/
│   ├── draft/
│   │   ├── source/<source_id>/main.md
│   │   ├── source/<source_id>/resources/
│   │   ├── originals/<file_id>
│   │   ├── configs/<revision>/book.yaml
│   │   └── previews/<revision>/{pages,assets,diagnostics}/
│   ├── quarantine/<version_id>/
│   └── versions/<version_id>/
│       ├── version.json
│       ├── book.yaml
│       ├── document-manifest.json
│       ├── source/
│       ├── originals/
│       └── published/{pages,assets}/
├── staging/<job_id>/
└── tmp/uploads/<upload_id>.part
```

Draft sources and config revisions are immutable after creation. `books.draft_revision`
selects the current draft configuration only as an index; the selected `book.yaml` remains
authoritative. Saving a config revision and enqueuing its preview build is one short database
transaction. Preview artifacts are derived and revision-scoped: an older ready preview may
remain visible with a stale marker while the worker builds the new revision, but it is never
mistaken for current validation. A publication build snapshots the source ID, config
revision and hashes and requires current-revision validation. Published versions contain a
self-sufficient immutable copy of authoritative inputs and derived outputs. Copy-on-write or
hard-link optimizations are allowed only when they cannot permit in-place mutation and
integrity is verified before publication.

### Publication and transaction boundary

1. Web records a publish request with captured source ID, config revision and base
   `current_version_id`; a SQLite transaction enqueues the job.
2. The worker atomically leases one job. A child process reads only the captured draft
   snapshots and builds under `staging/<job_id>`.
3. The child validates schemas, semantic structure, resource closure, checksums, generated
   pages, manifest and a deterministic search-row spool.
4. The worker fsyncs files and directories, renames staging to `versions/<version_id>` on
   the same filesystem, and fsyncs the versions parent.
5. One SQLite transaction inserts the `ready` version and all version-scoped FTS/short-query
   rows, then validates counts and referential identifiers. Any error rolls the transaction
   back; the complete directory remains non-public for reconciliation.
6. A short `BEGIN IMMEDIATE` transaction compares the captured source, config revision and
   base current version, verifies the complete marker, then updates
   `books.current_version_id`, visibility, version states, audit event and job result.
7. No publication transaction deletes old data. The current and immediately previous
   verified versions are retained; older versions are eligible for a separate cleanup job
   only after 24 hours.

### Recovery boundary

- Web upload files are uniquely created, byte-counted, fsynced and renamed before an import
  job references them.
- A worker renews its lease every 10 seconds; after 60 seconds another worker startup marks
  the job `interrupted`, removes incomplete staging and may enqueue one infrastructure-only
  retry from the preserved ZIP.
- Timeout, cancellation, content, schema, archive-limit and repeat interruption failures
  require explicit administrator retry.
- A completed `ready` version never becomes current during generic recovery. The
  administrator repeats the publish action, which reruns guarded cutover checks.
- Reconciliation validates `version.json`, manifest and required files synchronously for
  current pointers, schedules full hashes in the background, quarantines unreferenced
  complete directories for 24 hours, and contains unavailability to one book.

### Request boundary

- Public HTML resolves visibility and `current_version_id` once, opens only the matching
  immutable page, and uses a strong ETag containing version, route and renderer identity.
- Published HTML contains version-pinned resource URLs. Historical resources are served only
  for versions that were previously published and only while the book remains public.
- Search normalizes input, branches on Unicode code-point length, uses a bound literal FTS5
  phrase for three or more characters, and limits one/two-character scanning to the small
  current title/author/heading table.
- Original downloads authorize before conditional or Range evaluation, resolve only a
  registered file record, and use safe generated filenames without exposing storage paths.
- Draft/management/private responses are always `private, no-store`; anonymous private or
  nonexistent book resources share the same non-cacheable `404` representation.

The detailed relational and state model is in [data-model.md](./data-model.md), the HTTP and
CLI surfaces are in [contracts/](./contracts/), and executable acceptance guidance is in
[quickstart.md](./quickstart.md).

## Project Structure

### Documentation (this feature)

```text
specs/001-mineru-public-publishing/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── openapi.yaml
│   ├── admin-cli.md
│   └── passkey-policy.md
└── tasks.md                 # created only by speckit-tasks after plan approval
```

### Source Code (repository root)

```text
.github/workflows/
├── commitlint.yml
└── ci.yml
.githooks/
└── commit-msg
docs/third-party/
└── code-provenance.md

src/
├── components/
│   ├── auth/
│   ├── import/
│   ├── preview/
│   └── reader/
├── layouts/
├── pages/
│   ├── api/
│   │   ├── auth/[...all].ts
│   │   ├── books/
│   │   └── manage/
│   ├── login.astro
│   ├── manage/
│   └── read/
├── middleware.ts
├── auth/
├── cli/
├── compiler/
│   ├── archive/
│   ├── document/
│   ├── render/
│   ├── resources/
│   └── search/
├── db/
│   ├── migrations/
│   ├── repositories/
│   └── transaction/
├── domain/
├── http/
│   ├── authorization/
│   ├── cache/
│   ├── downloads/
│   └── errors/
├── jobs/
├── observability/
├── policy/
├── schemas/
├── storage/
├── worker/
└── env.d.ts

tests/
├── unit/
├── integration/
│   ├── archive/
│   ├── auth/
│   ├── compiler/
│   ├── publication/
│   ├── recovery/
│   ├── search/
│   └── storage/
├── contract/
├── e2e/
├── fixtures/
│   ├── mineru/
│   ├── hostile-archives/
│   └── search/
├── performance/
└── helpers/

scripts/
├── fixtures/
└── benchmarks/

docker/
├── Dockerfile
├── compose.yaml
└── Caddyfile
```

**Structure Decision**: Use one Astro/TypeScript project because Web, worker, compiler and
CLI share domain rules, migrations, schemas and storage code. Process entry points remain
separate, and server-only modules live outside browser-importable component paths. All
mutable data is rooted under a configured persistent data directory, not `public/`.

Repository history is part of the review boundary: commitlint enforces the approved type
and scope vocabulary locally and in pull-request CI, while `CONTRIBUTING.md` documents
examples and the source-provenance workflow. This does not create an automatic release
pipeline.

## Complexity Tracking

No constitution violations require justification.
