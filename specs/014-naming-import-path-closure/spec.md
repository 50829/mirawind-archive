# Feature Specification: Naming, Import, and Path Closure

**Feature Branch**: `[014-naming-import-path-closure]`

**Created**: 2026-08-24

**Status**: Draft

**Input**: User description: "统一意义明确的文件与函数命名；包内不再全部从长根别名导入；删除运行时 V2 命名和旧逻辑；检查并加固目录处理；使用 Browser 与 Chrome 验证应用。"

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Understand Code From Its Local Context (Priority: P1)

As a maintainer, I can identify a file, exported operation, and dependency from its name and
nearby imports without reconstructing historical migrations or repeatedly resolving long
repository-root paths.

**Why this priority**: Unclear names and mechanically long imports increase the cost and risk
of every later publishing, worker, and reader change.

**Independent Test**: Inspect every affected package and verify that local dependencies use a
consistent local form, cross-package dependencies remain explicit, and public module entry
files name their domain responsibility.

**Acceptance Scenarios**:

1. **Given** two source files owned by the same package, **When** one imports the other, **Then** the dependency is expressed by the shortest unambiguous local path.
2. **Given** a dependency crosses a package or business-module boundary, **When** its import is inspected, **Then** the target package and approved public application surface remain explicit.
3. **Given** a maintainer searches first-party runtime identifiers and filenames, **When** the results are reviewed, **Then** current concepts do not carry historical version suffixes or vague container names in the affected scope.

---

### User Story 2 - Keep One Current Runtime Path (Priority: P1)

As an operator, I receive the same import, preview, publish, worker-health, and reading behavior
through one current implementation without hidden legacy parsers or compatibility wrappers.

**Why this priority**: Renaming without deleting superseded behavior would preserve the same
coupling and ambiguity under new labels.

**Independent Test**: Exercise the current MinerU evidence, candidate build, publication, and
worker flows while proving that replaced runtime branches and forwarding exports no longer
exist.

**Acceptance Scenarios**:

1. **Given** current supported input and persisted data, **When** the application processes them, **Then** it uses one semantically named parser and one public operation.
2. **Given** unsupported old or unknown persisted data, **When** it is read, **Then** strict validation rejects it instead of invoking an old runtime path.
3. **Given** a formally versioned schema or external filename, **When** runtime APIs consume it, **Then** the stored version remains explicit while the API name describes the current concept.

---

### User Story 3 - Keep Directory Work Inside Its Boundary (Priority: P1)

As an operator importing hostile archives or maintaining local storage, I can rely on every
accepted path resolving to one canonical location inside its declared root, including during
failure and concurrent filesystem changes.

**Why this priority**: Directory ambiguity can cause incorrect resource binding, cleanup of the
wrong tree, data leakage, or archive extraction outside the intended staging area.

**Independent Test**: Run negative fixtures for ambiguous archive names, non-canonical internal
paths, symlinks, changed ZIP entries, prefix conflicts, and failed atomic writes, then verify
that no file is exposed or left outside the expected tree.

**Acceptance Scenarios**:

1. **Given** two archive paths that collide after Unicode normalization or case folding, **When** the archive is inspected, **Then** the entire import is rejected before extraction.
2. **Given** an absolute, drive-relative, control-character, dot-component, repeated-component, symlinked, or escaping path, **When** it reaches a storage boundary, **Then** it is rejected without following or rewriting it.
3. **Given** the archive changes between inspection and extraction, **When** entry identity no longer matches, **Then** extraction fails and removes its incomplete destination.
4. **Given** an atomic write fails before replacement, **When** cleanup completes, **Then** the previous durable file remains intact and no temporary representation remains.

---

### User Story 4 - Verify the Real Application in Both Browsers (Priority: P2)

As the administrator and a reader, I can still use the main library, management, publishing,
preview, and reading journeys after the internal cleanup in both requested browser surfaces.

**Why this priority**: Static checks cannot establish that route wiring, generated assets, and
client interactions survived large import and filename changes.

**Independent Test**: Use the in-app Browser and Chrome independently against the updated local
application and complete the named journeys at desktop and mobile widths while checking visible,
console, and network state.

**Acceptance Scenarios**:

1. **Given** a running updated application, **When** `/library`, `/manage`, and the task-health view are opened in each requested browser, **Then** they render and navigate without unexpected failures.
2. **Given** a prepared book, **When** publishing workbench, preview, published reader, and table-of-contents navigation are exercised, **Then** the current candidate and published content remain usable.
3. **Given** a narrow viewport, **When** the library, management, and reader views are inspected, **Then** controls remain reachable and content does not overlap.

### Edge Cases

- A persisted format legitimately includes a numeric schema version while its current runtime
  type must not encode that version in its name.
- A vendor-specified filename such as `content_list_v2.json` must remain discoverable without
  making the vendor version part of first-party API names.
- A local import becomes longer than a root alias because it crosses a package boundary; boundary
  clarity takes precedence over character count.
- A ZIP contains both explicit and implicit directory entries, or a file is added after a path was
  already inferred as a directory.
- A storage root exists but is a symlink, a managed child is replaced by a symlink, or the root is
  the filesystem root.
- Cleanup or validation is interrupted after a temporary file or extraction directory is created.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Product source under `src/` MUST use one documented import form for local package dependencies and one documented form for cross-package dependencies; tests and scripts MUST retain an explicit support-code rule.
- **FR-002**: Cross-business-module dependencies MUST continue to enter only through a semantically named public application API and MUST remain acyclic.
- **FR-003**: Architecture validation MUST resolve both relative and root-based internal imports before enforcing layering, coupling, public API, and cycle rules.
- **FR-004**: Current first-party runtime filenames, fields, types, and functions in the affected scope MUST describe their responsibility and MUST NOT encode `V1`, `V2`, `legacy`, or equivalent history.
- **FR-005**: Persisted schema versions, frozen renderer/compiler/profile identities, external format names, and offline reference values MUST retain required explicit version data.
- **FR-006**: Replaced runtime implementations, forwarding exports, compatibility wrappers, and fallback parsing branches in the affected scope MUST be removed after all callers move.
- **FR-007**: Internal persisted relative paths MUST have exactly one canonical POSIX representation and MUST reject ambiguous or escaping representations.
- **FR-008**: Archive path validation MUST reject Unicode/case-fold collisions, control characters, Windows drive ambiguity, traversal, unsafe prefixes, and resource-limit violations before writing entries.
- **FR-009**: Archive extraction MUST verify that every entry still matches the inspected identity and MUST remove incomplete output after any mismatch or failure.
- **FR-010**: Storage layout initialization and destructive cleanup MUST reject unsafe roots and symlink substitutions without following them outside the managed tree.
- **FR-011**: Atomic file replacement MUST preserve the prior durable representation and remove temporary files when any pre-replacement step fails.
- **FR-012**: Worker claim concurrency, child-process isolation, page-render concurrency, leases, cancellation, retry, health, RSS, and stage-duration behavior MUST remain unchanged.
- **FR-013**: Existing book, manifest, version marker, worker-health, and reference files MUST remain compatible under their currently approved strict-version rules without adding a migration.
- **FR-014**: The application MUST pass automated architecture, type, lint, unit, integration, end-to-end, reference-correctness, and representative performance checks affected by the refactor.
- **FR-015**: The in-app Browser and Chrome MUST each verify the library, management/health, import or prepared-book workflow, preview, published reader, navigation, and responsive presentation.
- **FR-016**: Runtime and architecture documentation MUST state the canonical naming, import, and path-boundary rules and list any intentionally versioned exceptions.

### Non-Functional Requirements

- **NFR-001**: The refactor MUST NOT change authentication, authorization, cache, indexing, or private-resource response behavior.
- **NFR-002**: Path rejection and cleanup MUST be deterministic, bounded, and testable with hostile fixtures; failure MUST NOT expose raw private paths or content.
- **NFR-003**: A representative build MUST stay within the existing wall-time tolerance of `max(5%, 1 s)` and RSS tolerance of `max(5%, 64 MiB)`.
- **NFR-004**: The feature MUST introduce no new authoritative data, database, external service, worker, queue, or request-path compilation.

### Key Entities

- **Source Package**: An ownership boundary whose internal dependencies use local paths and whose external dependencies remain explicit.
- **Application API**: The semantically named, narrow surface through which entrypoints and other business modules access one module.
- **Versioned Representation**: Persisted or externally defined data whose numeric version remains explicit even though current runtime API names are semantic.
- **Canonical Relative Path**: A non-empty POSIX path with no ambiguous separators, components, absolute prefix, or root escape.
- **Inspected Archive Entry**: The immutable identity expected to remain equal between ZIP inspection and extraction.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% of product source imports comply with the documented package-local or cross-package form, with zero unresolved or boundary-bypassing imports; affected support-code imports comply with their explicit rule.
- **SC-002**: Zero affected first-party runtime identifiers or filenames retain historical `V1`, `V2`, or `legacy` suffixes; all approved versioned data values remain strict and tested.
- **SC-003**: All path, archive, symlink, cleanup, and atomic-write negative fixtures reject safely, and failure leaves zero unexpected files outside or beside the managed target.
- **SC-004**: Architecture analysis reports zero file cycles, module cycles, forbidden dependencies, deep cross-module imports, excessive coupling, or ambiguous import-style diagnostics for product source.
- **SC-005**: Worker behavior remains one claimed task at a time and at most four rendered pages in flight, with health queue/RSS/stage observations still available.
- **SC-006**: Existing automated suites and all fifteen registered reference comparisons pass; representative wall time and RSS remain within approved tolerance.
- **SC-007**: Both requested browsers complete all listed desktop journeys, and at least one mobile-width pass, with zero blocking console errors, failed required requests, blank views, or incoherent overlap.

## Assumptions

- The request concerns first-party names and import expressions, not immutable data values or
  third-party/vendor filenames that require explicit versions.
- The current clean database baseline remains the only supported database layout; no historical
  database migration is added.
- Relative imports are local to one ownership package. Cross-package and cross-module dependencies
  remain explicit even when a relative spelling would contain fewer characters.
- Root product files form a `src-root` package. `@/schemas/*` is an intentional authoritative-data
  alias outside `src/`, not a product package import.
- Tests and scripts use relative imports within their own support tree; their existing configured
  product-source form is not mechanically rewritten by the product import canonicalizer.
- Existing feature 013 module, composition, worker concurrency, and observability behavior is the
  baseline to preserve.
- Browser verification can use the repository's prepared local test data and a free localhost port;
  it does not require changing the existing Docker preview on port 4321.

## Out of Scope

- Renaming immutable persisted fields solely to change stylistic casing.
- Removing required schema versions, compiler/renderer/profile identities, or MinerU vendor names.
- Adding filesystem portability beyond the approved Linux host, a general file manager, or folder
  product features deferred to later milestones.
- Changing publishing semantics, worker concurrency, authorization, cache behavior, or database
  schema.
