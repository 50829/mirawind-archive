# Feature Specification: Publishing Pipeline Performance

**Feature Branch**: `008-publishing-pipeline-performance`

**Created**: 2026-07-30

**Status**: Approved

**Input**: Replace the coupled preview/publication pipeline with one recoverable candidate
build, reorganize the monolith around enforceable module boundaries, and measurably reduce
processing time without changing content correctness or reader behavior.

## User Scenarios & Testing

### User Story 1 - Reach a trustworthy preview sooner (Priority: P1)

As an administrator, I can save a draft and receive a complete, content-correct preview without
waiting for duplicated document processing.

**Why this priority**: Draft-to-preview latency is the dominant interactive publishing wait and
the preview is the administrator's release evidence.

**Independent Test**: Save revisions for all fifteen reference books, compare each ready preview
with its reference, and measure accepted-to-preview time against the frozen baseline.

**Acceptance Scenarios**:

1. **Given** a valid saved draft, **When** background processing completes, **Then** one complete
   preview is ready with the expected content, structure, diagnostics and resources.
2. **Given** a large valid draft, **When** processing runs, **Then** progress stays bounded and
   ordered while the administrator can continue using unrelated reading pages.
3. **Given** a second save while the previous candidate is ready, **When** the new revision is
   accepted, **Then** the previous unpublished candidate cannot be published accidentally.

---

### User Story 2 - Publish exactly what was previewed (Priority: P1)

As an administrator, I can publish the ready candidate immediately and know that the public
version is the exact semantic output I reviewed.

**Why this priority**: Rebuilding after approval wastes time and permits preview/public drift.

**Independent Test**: Publish each ready candidate, compare its semantic identity and normalized
page output with the preview, and prove that publication performs no document processing.

**Acceptance Scenarios**:

1. **Given** a ready candidate matching the current revision, **When** it is published, **Then**
   the public pointer changes atomically and the response identifies that candidate.
2. **Given** the same successful publication request is repeated, **When** it is handled again,
   **Then** the same success is returned without a second publication or duplicate audit.
3. **Given** a stale, failed, discarded or blocking candidate, **When** publication is requested,
   **Then** the current public version remains unchanged and the request is rejected safely.

---

### User Story 3 - Recover every interrupted build (Priority: P1)

As an administrator, I can see a stable terminal result after failure, cancellation or restart
and retry without exposing or publishing partial output.

**Why this priority**: Faster processing is not acceptable if partial candidates or stuck states
require manual database or filesystem repair.

**Independent Test**: Inject interruption around durable writes, rename and database commit,
then restart reconciliation and retry the same revision.

**Acceptance Scenarios**:

1. **Given** a failure or cancellation, **When** finalization runs, **Then** the build and draft
   candidate share one terminal outcome with a safe reason and last bounded progress.
2. **Given** files were made durable but not registered, **When** reconciliation runs, **Then**
   the orphan is removed without altering the current published version.
3. **Given** a retryable terminal attempt, **When** it is retried, **Then** a new attempt is bound
   to the revision and only its completed candidate can become ready.

---

### User Story 4 - Change the pipeline without hidden coupling (Priority: P2)

As a maintainer, I can locate a publishing or reading responsibility in one business module,
change its infrastructure adapter without changing pure content logic, and rely on automated
dependency checks to reject architectural regressions.

**Why this priority**: The current mixed compiler, service, storage and UI dependencies make
correctness and performance changes expensive and unsafe.

**Independent Test**: Run the architecture gate over all product source and intentionally inject
each forbidden import class in isolated fixtures to prove it is rejected.

**Acceptance Scenarios**:

1. **Given** a core processing module, **When** its dependency graph is inspected, **Then** it has
   no web, process, persistence, filesystem or framework dependency.
2. **Given** a page, worker or CLI entrypoint, **When** its imports are inspected, **Then** it
   reaches business behavior only through declared application entrypoints and composition.
3. **Given** a reverse, cyclic, deep-boundary or non-canonical internal import, **When** validation
   runs, **Then** it fails with the shortest actionable dependency path.

---

### User Story 5 - Keep reading responsive during builds (Priority: P2)

As a reader, I can continue opening published pages, resources and search results while a large
book candidate is being built.

**Why this priority**: Background optimization must not transfer cost or memory pressure to the
public reading path.

**Independent Test**: Issue at least 200 uncached reader requests concurrently with candidate
work and measure page, resource and search behavior.

**Acceptance Scenarios**:

1. **Given** a candidate build is consuming its allowed resources, **When** a current public page
   is requested, **Then** it is served from immutable output without document processing.
2. **Given** concurrent cold requests for one manifest, **When** they resolve pages and resources,
   **Then** they share one validated load and return only authorized current-version data.

### Edge Cases

- A revision is saved immediately after its prior candidate becomes ready.
- A retry completes after a newer attempt or revision has already become authoritative.
- The process exits before durable rename, after rename, during the registration transaction or
  immediately after commit.
- A candidate is ready while the book is deleted, made private or changed by another session.
- A large book has thousands of headings, hundreds of pages, large resources or invalid images.
- The fifteen-book benchmark has noisy runs, a single-book regression or incomplete fixture data.
- Concurrent readers request the same cold manifest, old version, missing resource or private book.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST accept a draft revision with optimistic concurrency and schedule
  exactly one current candidate attempt without processing the complete document in that request.
- **FR-002**: Candidate processing MUST compile one whole-book model per attempt and stream
  route-neutral semantic pages with bounded concurrency and deterministic order, then derive
  preview and public representations without rebuilding the book.
- **FR-003**: A ready candidate MUST contain complete immutable configuration, source, original,
  page, resource, manifest, search, presentation, diagnostic and identity evidence required for
  both preview and publication.
- **FR-004**: Publication MUST atomically promote the exact ready candidate named by the current
  revision and MUST NOT schedule or perform document processing.
- **FR-005**: Candidate completion MUST atomically bind ready state, version identity, search,
  presentation and successful job outcome after files are durable.
- **FR-006**: Failure, cancellation, interruption and retry MUST produce deterministic candidate
  states, preserve safe bounded progress and prevent stale attempts from becoming ready.
- **FR-007**: Reconciliation MUST remove unregistered upload, extraction, source/config and
  candidate artifacts without publishing or mutating a valid immutable version.
- **FR-008**: Preview and public output MUST share semantic content and identity while retaining
  their distinct authentication, authorization, cache, indexing and capability behavior.
- **FR-009**: Publishing, reading, catalog and identity responsibilities MUST have documented,
  enforceable single-direction module boundaries and explicit application entrypoints.
- **FR-010**: Internal imports MUST use one canonical convention and automated validation MUST
  reject cross-boundary deep imports, reverse dependencies and all dependency cycles.
- **FR-011**: Content processing MUST reuse indexed source, block, heading, range, page and
  resource information instead of repeatedly rescanning or reconstructing identical inputs.
- **FR-012**: Page and resource work MUST use bounded concurrency, deterministic output order and
  bounded retained results so cancellation remains effective.
- **FR-013**: Published reading MUST resolve current pages, resources, originals and search through
  a dedicated reading boundary and MUST NOT execute publishing analysis or compilation.
- **FR-014**: The complete fifteen-book reference set MUST remain an exact correctness gate during
  every accepted performance comparison.
- **FR-015**: The implementation MUST remove the old preview-build, publish-build and mixed compiler
  runtime paths when the candidate path becomes active.

### Non-Functional Requirements

- **NFR-001**: Existing hostile-input, authentication, private-resource hidden-404, immutable
  publication, cancellation, timeout and deletion guarantees MUST remain enforced.
- **NFR-002**: Every new response and persisted representation MUST define authorization, cache,
  indexing, lifecycle and recovery behavior.
- **NFR-003**: Performance comparisons MUST bind the workload, fixture hashes, environment,
  baseline commit, repeated run order, per-stage durations and peak memory.
- **NFR-004**: No book may regress beyond the stated tolerance even when aggregate time improves.
- **NFR-005**: The architecture validation and type checks MUST cover both runtime and type-only
  imports and run in the standard lint/build gates.
- **NFR-006**: The implementation MUST remain one Linux-host monolith with one web process, one
  same-codebase worker, one SQLite WAL database and local private storage.
- **NFR-007**: Outside composition roots, no product source file may have more than twelve direct
  internal dependencies and no application use case may require more than eight injected ports;
  the completed architecture gate MUST contain no coupling exception allowlist.
- **NFR-008**: Formal performance evidence MUST run baseline and candidate in `AB/BA/AB` paired
  order on the same host and expand to five pairs when a measured comparison has coefficient of
  variation above 10%.
- **NFR-009**: The concurrent reading gate MUST overlap candidate work with at least 200 uncached
  page requests and MUST report page, resource and search results separately.

### Key Entities

- **Build Candidate Command**: Immutable worker input binding source, configuration revision,
  identities and the attempt that may become current.
- **Compiled Book**: The only whole-book in-memory model, containing one parsed document tree,
  configured headings, range-based page plans, logical resources, identity and diagnostics.
- **Rendered Page Stream**: Ordered, bounded-backpressure execution protocol yielding one
  route-neutral semantic page at a time; it is not a persisted business entity.
- **Candidate Build Artifact**: Strict, bounded child-to-parent result naming the durable candidate
  tree, semantic digest, counts, diagnostics and registration evidence.
- **Draft Candidate**: Application and persistence lifecycle binding one revision to its current
  build attempt and terminal result.
- **Semantic Digest**: Deterministic identity of the shared candidate content and relevant inputs.
- **Module Boundary**: Allowed dependency direction and public application surface for one domain.
- **Sealed Extraction**: Validated, bounded, immutable import tree reusable by draft preparation.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Every performance round matches all fifteen reference v2 fixtures exactly.
- **SC-002**: Paired median total wall time across the fifteen books is at least 30% lower than the
  frozen baseline and the slowest five books improve by at least 35%.
- **SC-003**: Median accepted-to-preview time improves by at least 25% and publish-to-public time
  improves by at least 90%.
- **SC-004**: No individual book regresses by more than the greater of 5% or one second.
- **SC-005**: Peak resident memory does not exceed the baseline by more than the greater of 5% or
  64 MiB.
- **SC-006**: Fourfold source-analysis inputs grow by less than sixfold in the isolated complexity
  gate.
- **SC-007**: At least 200 reader requests overlapping background work retain an uncached p95 of
  300 ms or less, and search p95 remains below one second.
- **SC-008**: All defined crash points leave either one registered candidate or reclaimable orphan
  output, with no partial publication and no indefinitely building draft candidate.
- **SC-009**: The dependency graph contains zero cycles and zero forbidden or non-canonical product
  source imports.
- **SC-010**: Preview and public output for a candidate have identical semantic digests and
  normalized content for all fifteen books.

## Assumptions

- The fifteen registered MinerU 3.4.4 bundles and reference v2 files remain locally available.
- The frozen reference-exact performance baseline commit is `93e01432`, based directly on the
  original `c176fdd` diagnostic baseline with only the nested body-role correction and matching
  validator contract backported.
- Catalog and identity internals may move to enforce global boundaries, but their user-visible
  behavior and interface design do not change.
- A shared semantic page may be materialized into distinct preview and public shells because their
  authorization and capability policies differ.

## Out of Scope

- New metadata, visibility, folder, batch-management or reading-state features.
- UI redesign of home, login, library, details, workbench or Reader.
- Additional services, databases, queues, deployment units or package workspaces.
- Changing the content-correctness rules or reference v2 truth established by 007.
