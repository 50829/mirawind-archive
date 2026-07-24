<!--
Sync Impact Report
- Version change: unratified template → 1.0.0
- Added principles:
  - I. Authoritative Sources and Rebuildability
  - II. Atomic Publication and Recoverability
  - III. Security Boundaries Are End-to-End
  - IV. Build Off the Request Path
  - V. Evidence Before Completion
- Added sections:
  - Architecture Constraints
  - Spec-Driven Delivery Gates
- Removed sections: none; template placeholders were replaced
- Templates:
  - ✅ .specify/templates/plan-template.md
  - ✅ .specify/templates/spec-template.md
  - ✅ .specify/templates/tasks-template.md
- Runtime guidance:
  - ✅ README.md
- Follow-up TODOs: none
-->
# Mirawind Library Constitution

## Core Principles

### I. Authoritative Sources and Rebuildability

Markdown and the versioned `book.yaml` MUST remain the only editable, portable source of
published book content and publishing configuration. ASTs, HTML, search indexes, resource
maps, manifests, and other derived artifacts MUST be reproducible from authoritative inputs.
`book.yaml` and `document-manifest.json` MUST use independent integer schema versions,
explicit migrations, strict validation, and rejection of unsupported newer versions.
Private reading data and credentials MUST NOT enter portable publishing configuration.

Rationale: a single authority prevents silent divergence, makes migrations auditable, and
allows every generated version to be rebuilt after code or storage changes.

### II. Atomic Publication and Recoverability

Readers MUST observe a complete old version or a complete new version, never a partially
built mixture. Published files MUST live in immutable version directories. SQLite's
`current_version_id` MUST be the sole current-version pointer, changed only after files,
manifest, and search data are durable and validated. Any build, index, commit, or recovery
failure MUST preserve or restore the last verified published version. Recovery routines
MUST NOT publish `ready`, staging, or orphaned versions without an explicit publish action.

Rationale: publication crosses database and filesystem boundaries; ordering and recovery
rules are product correctness, not optional implementation detail.

### III. Security Boundaries Are End-to-End

Every request for HTML, images, attachments, search results, administration, and APIs MUST
enforce server-side authentication and resource authorization. Private data and generated
book resources MUST remain outside directly served public directories. MinerU ZIPs and all
imported paths MUST be treated as hostile input and validated against traversal, special
files, resource exhaustion, malformed media, and parser attacks. Authentication, WebAuthn,
password hashing, Markdown parsing, sanitization, and cryptographic behavior MUST use
maintained libraries rather than project-specific protocol implementations. Logs MUST NOT
contain credentials, session secrets, private body content, or unsafe raw paths.

Rationale: hiding UI elements or relying on unguessable URLs does not create a security
boundary; protection must cover every representation and failure path.

### IV. Build Off the Request Path

Markdown parsing, AST creation, KaTeX rendering, code highlighting, image processing, and
search indexing MUST run in bounded background jobs, never in a reader request. Reader
requests MUST use immutable pre-generated artifacts and remain available on the previous
published version while a rebuild runs. On the reference single-server deployment, an
uncached public reading response MUST meet the approved p95 target of 300 ms. Background
jobs MUST enforce the approved upload, extraction, image, path, concurrency, and timeout
budgets and MUST be terminable without affecting the Web process.

Rationale: large books make build latency variable; separating build from reads keeps the
public product responsive and isolates resource failures.

### V. Evidence Before Completion

Every feature MUST trace user-visible behavior to a specification requirement and MUST
include automated evidence for its critical success and failure paths. Parser, schema,
authorization, publication, recovery, cache, download, and migration changes require
fixture-based integration tests; security and transaction tests MUST include negative and
crash-boundary scenarios. Performance claims MUST be measured with representative and
stress fixtures, not inferred from small examples. A feature is not complete while its
specification, plan, tasks, implementation, tests, and current documentation disagree.

Rationale: this product handles hostile archives and durable publications, so happy-path
unit tests alone cannot establish correctness.

## Architecture Constraints

- The baseline deployment MUST remain a single Linux host with one Astro Web process, one
  worker process from the same codebase, SQLite in WAL mode, and a local persistent
  filesystem.
- Redis, external queues, object storage, additional databases, microservices, or multiple
  application instances MUST NOT be introduced without an approved constitution amendment
  or a documented upgrade condition already present in the product decisions.
- The Web process MUST own HTTP, sessions, authorization, and response headers. The worker
  MUST own bounded import and build execution through the durable SQLite task queue.
- Public and private cache behavior MUST be explicit for every new response class. Public
  cacheability MUST never include administrator or private reading state.
- Complexity MUST be justified against a simpler maintained component or direct design.
  Mature components MUST be preferred for infrastructure and protocols.

## Spec-Driven Delivery Gates

1. A feature starts with an approved feature specification containing independently
   testable user journeys, explicit exclusions, failure behavior, security boundaries,
   measurable outcomes, and no unresolved critical clarification markers.
2. Planning MUST identify authoritative data, derived data, schema and migration impact,
   transaction boundaries, recovery behavior, request-path work, resource budgets, and
   representative fixtures.
3. Tasks MUST map to requirements and include required negative, integration, recovery,
   migration, and performance evidence before implementation tasks are considered complete.
4. Implementation MUST proceed from failing evidence to passing behavior for
   constitution-critical paths. Generated artifacts and migrations MUST be validated before
   any publication pointer changes.
5. Before implementation begins, Constitution Check MUST pass. After design and task
   generation, consistency analysis MUST report no unmitigated CRITICAL findings.
6. Decision changes MUST first update the decision log and affected specification, then
   propagate to schemas, plans, tasks, tests, and runtime documentation.

## Governance

This constitution governs engineering and delivery. Approved product intent remains in
`docs/product/product-spec.md` and `docs/decisions/decision-log.md`; feature artifacts MUST
implement that intent without contradicting this constitution.

Amendments require:

1. a written rationale and impact analysis;
2. explicit owner approval;
3. semantic version change;
4. migration or remediation steps for affected specs, templates, code, tests, and data.

Versioning follows semantic versioning:

- MAJOR for removing or redefining a principle incompatibly;
- MINOR for adding a principle or materially expanding mandatory governance;
- PATCH for non-semantic clarification.

Every feature plan and review MUST perform Constitution Check. Violations block delivery
unless the constitution itself is amended; a plan's Complexity Tracking section may explain
necessary complexity but cannot waive a MUST requirement.

**Version**: 1.0.0 | **Ratified**: 2026-07-24 | **Last Amended**: 2026-07-24
