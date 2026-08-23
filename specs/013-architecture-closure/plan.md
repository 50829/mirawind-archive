# Implementation Plan: Architecture Closure

**Branch**: `main` | **Date**: 2026-08-23 | **Spec**: [spec.md](spec.md)

**Input**: Reduce remaining module and orchestration coupling, preserve bounded worker behavior, and
make queue delay, stage duration and task process-tree memory observable in production.

## Summary

Close the gap between D-117's intended modular monolith and the current implementation. Extend the
architecture graph from file-level rules to an acyclic business-module graph, remove Catalog's
knowledge of Publishing formats and lifecycle tables, and split broad cleanup capabilities into
least-authority ports. Replace the broad server and worker composition files with focused roots;
the worker will have one frozen-input capture, attempt runner, terminal coordinator, recovery path
and child handler registry. Extend the existing private worker-health snapshot with bounded queue,
attempt-stage and process-tree RSS observations without changing persistent schemas, public APIs,
publishing formats or runtime topology.

## Technical Context

**Language/Version**: TypeScript 6.0 in strictest mode on Node.js 24.x

**Primary Dependencies**: Astro 7.1, React 19.2, better-sqlite3 12.11, Pino 10.3, existing
unified/remark/rehype, KaTeX, Shiki, Sharp and zip.js publishing stack

**Storage**: SQLite WAL plus private local source, staging and immutable version trees; operational
worker health remains a bounded derived JSON file under the private temporary directory

**Testing**: Vitest unit/architecture/contract/integration projects, Playwright worker recovery,
reference-v2 comparison and established build/read/search benchmarks

**Target Platform**: One Linux host, one Astro Web process and one same-codebase worker process

**Project Type**: Server-rendered modular monolith with an isolated background publishing compiler

**Performance Goals**: Public read p95 at most 300 ms and search p95 below 1,000 ms during the
established overlapping workload; representative job wall and process-tree RSS remain within
`max(5%, 1 s)` and `max(5%, 64 MiB)` regression tolerances

**Constraints**: One globally running job; at most four rendered pages in flight; 10-second lease
heartbeat, 60-second lease expiry, 30-minute job timeout and 10-second termination grace; health
updates on state changes with one-second coalescing, at most every five seconds while active and every
60 seconds while idle; no raw
paths, original filenames, content or credentials in observations

**Scale/Scope**: 260 current product source files, seven worker task kinds, 2 GiB uploads, 20,000
archive entries, 256 MiB Markdown, fifteen private MinerU reference books and one 500-page stress book

## Constitution Check

### Pre-Design Gate

- **Authority & schemas - PASS**: Markdown and `book.yaml` v4 remain the only editable publication
  authority. Manifest v3, version marker v3, presentation and health observations remain derived.
  No database, portable schema, identity or worker IPC protocol changes are planned. The disposable
  worker health file clean-switches from its unversioned shape to strict v2; old, unknown or malformed
  files are rejected as unavailable and atomically rebuilt by the worker on startup.
- **Atomicity & recovery - PASS**: Candidate registration, publication promotion, deletion and current
  version recovery retain their existing immediate transactions. Composition moves business SQL to
  owning adapters but preserves the single shared transaction around cross-module operations.
- **Security boundary - PASS**: No response class becomes public. Worker health remains behind the
  authenticated private/no-store health API and stores only opaque IDs, safe classifications and
  bounded numbers. Host `/proc` reads are limited to the known isolated child process tree.
- **Request-path budget - PASS**: Queue and RSS work runs in the worker parent. Reader routes gain no
  parsing, rendering, queue query or process inspection. One job and four-page concurrency remain.
- **Evidence - PASS**: Module-cycle fixtures, port ownership tests, worker attempt unit/integration
  tests, process termination, retry/recovery, publication crash boundaries, deletion, reference exact,
  representative wall/RSS and concurrent reader/search evidence are required.
- **Simplicity - PASS**: The design reuses SQLite, the existing child process, health file, management
  API and logger. It adds no service, queue, database, package workspace or telemetry dependency.

### Post-Design Gate

- Publication and reader formats remain unchanged and rebuildable.
- The health snapshot is explicitly derived, bounded, overwrite-only and disposable.
- One worker loop awaits one attempt; `renderPages()` retains its four-page ordered backpressure.
- Attempt execution returns an outcome; only the terminal coordinator mutates terminal lifecycle
  state. Recovery reuses the same retry and subject-lifecycle owners.
- Catalog no longer parses Publishing formats or queries Publishing lifecycle rows, eliminating the
  current module-level dependency cycle.
- No constitutional violation or complexity exception is required. **Result: PASS.**

## Design

### 1. Enforce an acyclic business-module graph

- Aggregate existing resolved file edges by business module and reject module-level strongly
  connected components in the architecture check.
- Add a negative fixture where both modules legally import the other's `application/public.ts`; the
  fixture must fail with a module-cycle diagnostic.
- Keep the direction `Reader -> Publishing -> Catalog`. Reader consumes narrow immutable renderer
  assets and manifest projection; Publishing maps validated version artifacts into Catalog's bounded
  presentation input and invokes Catalog presentation writer/remover ports.
- Move presentation reconciliation candidate enumeration to Publishing's version adapter. Catalog's
  repository owns only presentation rows and current Catalog projection behavior.

### 2. Narrow cross-module operations

- Replace the broad Publishing cleanup capability exposed to Catalog with separate cancellation,
  removal-inventory and record-purge ports. The current SQLite cleanup adapter may implement all
  three, while each use case receives only the operation it calls.
- Define a Catalog-owned bounded presentation input and constructor. Publishing validates and maps
  `book.yaml`/manifest data before crossing the port; Catalog has no dependency on Publishing parsers,
  version records or canonical helpers.
- Move current-version verification reads and recovery mutations behind Catalog and Publishing
  application operations. Composition retains the outer transaction and sequencing but contains no
  `books`, `book_versions` or audit SQL.
- Replace worker bootstrap's direct current-version query with a Publishing startup verification
  scheduling operation that returns or queues only bounded version identities.
- Reduce Reader's Publishing dependency to immutable renderer assets and a bounded reader-manifest
  parser rather than general publication format utilities.

### 3. Split server and worker composition by responsibility

- Replace `composition/server.ts` with focused catalog, identity, publishing-draft,
  publishing-import, publishing-job, publication and reader roots. Update consumers directly and do
  not retain a forwarding barrel.
- Split worker parent behavior into frozen input capture, attempt execution, attempt completion,
  attempt recovery, health reporting, loop and bootstrap. `executeAttempt` manages heartbeat,
  cancellation and the child process but does not write terminal state.
- One terminal coordinator interprets the child outcome and delegates generic, candidate and purge
  terminal transitions to their existing owners and transactions.
- Reuse one recovery composition function at startup and during polling, removing duplicate wiring.
- Make the child IPC file a bootstrap around the existing discriminated registry. Handler groups own
  publishing build, import preparation, version maintenance and deletion/reclamation outcomes.

### 4. Add bounded production worker observations

- Add a read-only queue observation to the job adapter: queued count, running count and oldest queued
  age calculated from safe timestamps.
- Track attempt elapsed time and phase transitions from the parent's monotonic clock. Same-phase
  progress updates extend the current stage; a phase change closes the preceding stage exactly once.
- Reject decreasing same-phase progress in the job repository. Phase changes may reset completed
  units under the existing phase contract.
- Sample RSS for the known child PID and its Linux descendants at a 250 ms interval with no overlapping
  samples. A racing or unreadable process returns `null`; sampling never terminates work.
- Extend `ChildExecution` with the peak process-tree RSS observation. This is an internal parent result,
  not a worker IPC protocol change.
- Move existing child phase notifications to the actual entry of each phase before deriving elapsed
  time; detailed compiler micro-stages remain benchmark-only.
- Make one health reporter the sole writer of `worker-health.json`. It retains the latest checkpoint,
  queue snapshot and current/recent attempt, writes atomically, suppresses unchanged snapshots and
  coalesces repeated state changes for one second while limiting active refreshes to five seconds and
  idle refreshes to 60 seconds.
- Treat sampling, serialization and health-file write failure as an observation warning only; keep
  task execution and terminal state unchanged and retry on the next bounded refresh.
- Keep Web's in-process request metrics separate and expose the extended worker snapshot through the
  existing authenticated private/no-store health response.

## Project Structure

### Documentation

```text
specs/013-architecture-closure/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── architecture-boundaries.md
│   ├── orchestration.md
│   └── worker-observability.md
├── checklists/
└── tasks.md
```

### Source Code

```text
src/
├── composition/
│   ├── server/
│   │   ├── catalog.ts
│   │   ├── identity.ts
│   │   ├── publication.ts
│   │   ├── publishing-drafts.ts
│   │   ├── publishing-imports.ts
│   │   ├── publishing-jobs.ts
│   │   └── reader.ts
│   ├── worker/
│   │   ├── bootstrap.ts
│   │   ├── capture-frozen-input.ts
│   │   ├── complete-attempt.ts
│   │   ├── execute-attempt.ts
│   │   ├── health-reporter.ts
│   │   ├── loop.ts
│   │   └── recover-attempts.ts
│   ├── worker-child/
│   │   ├── handlers/
│   │   └── registry.ts
│   ├── storage-reconciliation.ts
│   ├── version-verification.ts
│   └── verify-version-job.ts
├── entrypoints/worker/
│   ├── child-runner.ts
│   ├── job-child.ts
│   ├── job-registry.ts
│   └── protocol.ts
├── modules/
│   ├── catalog/{application,adapters}/
│   ├── publishing/{application,adapters}/
│   └── reader/{application,adapters}/
├── observability/
│   ├── attempt-observation.ts
│   └── metrics.ts
└── platform/process/process-tree-rss.ts

scripts/architecture/
├── boundaries.ts
└── dependency-graph.ts

tests/
├── architecture/
├── unit/{observability,worker}/
├── integration/{publication,recovery,deletion}/
└── e2e/worker-recovery.spec.ts
```

**Structure Decision**: Preserve the D-117 business modules and inward dependency rule. New files
extract current responsibilities; they do not create another layer or deployment unit. Composition
may import concrete adapters but contains no business SQL or lifecycle rules. Platform process
inspection is business-neutral and returns bounded nullable values.

## Delivery Phases

1. Add module-level dependency evidence and eliminate Catalog-to-Publishing coupling.
2. Split least-authority ports and move remaining business SQL out of composition.
3. Split server composition and update consumers without compatibility exports.
4. Establish attempt outcome tests, then split worker parent and child orchestration.
5. Add monotonic progress, queue/stage/RSS observation and the single health snapshot writer.
6. Run recovery, deletion, publication, reference, performance and Spec Kit convergence gates.

## Complexity Tracking

No constitution violations or additional infrastructure are required.
