# Research: Publishing Pipeline Performance

## Decision 1: Expose Four Publishing Build Boundaries

**Decision**: use `BuildCandidateCommand → CompiledBook → AsyncIterable<RenderedPage> →
CandidateBuildArtifact`. `CompiledBook` is the only whole-book in-memory model. `PagePlan` stores
block intervals and IDs rather than page-sized document copies. Byte offsets and lookup maps are
local compilation indexes.

**Rationale**: the business has one meaningful transformation from authoritative source/config to a
compiled book, followed by page production and a durable worker result. Separate public
`SourceDocument`, `AnalyzedDocument`, `LaidOutDocument`, `OutputDocument` and `CandidatePlan` values
would mostly rename transient steps, increase conversion/copy cost, and make changes cross more APIs.

**Alternatives considered**: a seven-stage immutable IR chain was rejected as unjustified for this
pipeline; a single giant candidate object retaining every rendered page was rejected because it
prevents backpressure and reproduces the current RSS problem.

## Decision 2: Treat AsyncIterable as an Execution Protocol

**Decision**: `renderPages(book)` returns ordered `AsyncIterable<RenderedPage>`. The implementation
may render at most four pages concurrently, buffers only the next ordinal gap, merges diagnostics by
page ordinal, and stops scheduling promptly after cancellation.

**Rationale**: this separates the durable domain values from how work is scheduled while providing
native pull-based backpressure. A consumer can write preview/public shells, search spool rows and
manifest entries before releasing each page.

**Alternatives considered**: `Promise.all(Page[])` retains the whole result and is current evidence
for high RSS; a Node stream would add byte-oriented machinery around structured objects; an external
queue or worker-thread pool would add infrastructure before profiling justifies it.

## Decision 3: Organize by Business Module, Then Layer

**Decision**: use `modules/<domain>/{core,application,adapters}`. Publishing core contains only
`preparation` and `publication`. Reader server behavior is a domain module; ReaderShell rendering and
browser interaction are in `web/features/reader`. Astro pages, worker and CLI are entrypoints.
Composition roots alone construct use cases with adapters.

**Rationale**: the current `compiler`, `services`, `db`, `storage`, `jobs` and components mix business,
framework and runtime axes. Business-first modules give every file one ownership answer and make the
dependency direction enforceable.

**Alternatives considered**: global layer folders preserve the current scattering; separate packages
or apps add build/deployment complexity without reuse or independent deployment; verb-based
publishing submodules recreate the rejected IR chain in the directory tree.

## Decision 4: Enforce Canonical Imports with an AST Graph

**Decision**: product TypeScript/Astro source imports through `@/`. The architecture tool resolves
runtime, dynamic and type-only edges, rejects product-source cross-directory relative imports,
cycles, core-to-outer edges, adapter imports from application, cross-module deep imports and entrypoint
bypasses. Module coupling budgets are checked from the same graph and reported with a shortest path.

**Rationale**: ESLint path patterns alone cannot reliably detect cycles or resolve aliases and
type-only edges. A deterministic AST graph can test both the policy and negative fixtures while lint
provides fast editor feedback.

**Alternatives considered**: conventions alone are not enforceable; a large third-party dependency
cruiser was not selected before checking whether the TypeScript compiler API can cover the small
required rule set; package boundaries are too expensive for this monolith.

## Decision 5: Build Once, Promote Synchronously

**Decision**: `build_candidate` writes and validates source/config/originals, semantic pages, assets,
manifest, search spool, presentation and preview evidence once. After durable rename, one immediate
transaction records ready version, current candidate, search, presentation and successful job.
`POST publish` validates the exact ready candidate and atomically changes `current_version_id`; it does
not create a job.

**Rationale**: measured preview and publish configured-document work totals 259.021 seconds and page
rendering totals roughly 93 seconds. A second build both wastes this time and permits semantic drift.
The immutable candidate already has every publication artifact.

**Alternatives considered**: caching only the AST inside the old jobs leaves duplicate rendering,
resource and recovery paths; promoting preview HTML directly fails because preview/public policies
differ; rebuilding on publish fails the latency and identity requirements.

## Decision 6: Keep Two Durable Transaction Boundaries

**Decision**: filesystem creation, validation, fsync and rename happen before candidate registration.
Registration is one database transaction. Public promotion is a separate short database transaction.
Reconciliation removes unregistered trees, marks interrupted attempts terminal, and never promotes a
ready or orphan candidate.

**Rationale**: SQLite cannot atomically include filesystem writes. The ordering makes every crash
state either invisible old publication, a reclaimable orphan, a registered ready candidate, or a
fully promoted version.

**Alternatives considered**: holding a database write transaction across rendering blocks readers
and recovery; automatic promotion during reconciliation violates explicit publication; a second
filesystem current pointer would split authority.

## Decision 7: Optimize Proven Hotspots in Order

**Decision**: first linearize source-region/byte-offset work and related typography/page indexes,
then remove duplicate preview/publish compilation, then bound page rendering and optimize reader/I/O.
Repeat archive extraction reuse is conditional on a proven sealed-extraction lifecycle.

**Rationale**: the fifteen-book profile measured 116.988 seconds in source regions, 259.021 seconds in
duplicate configured-document compilation, 93.12 seconds in duplicate page rendering and 2.16 GiB
peak RSS. SQLite/FTS and resource copy are not the leading measured wall-time families.

**Alternatives considered**: tuning WAL or INSERT batching lacks evidence; increasing concurrency may
raise RSS and reader latency; weakening security/hash/fsync checks is prohibited.

## Decision 8: Use Paired, Reference-Exact Performance Evidence

**Decision**: compare baseline `6be12808` and candidate on one host in AB/BA/AB order, expanding to
five pairs when coefficient of variation exceeds 10%. The baseline is `c176fdd` plus the one-line
nested body-role correctness backport needed for 15/15 reference exactness; it contains no performance
optimization. Bind commits, dirty state, lockfile, fixture hashes, environment, order, per-stage time
and process-tree RSS. Run fifteen reference comparisons in every round and overlap at least 200 reader
requests.

**Rationale**: the 901.234-second `c176fdd` result is one diagnostic run with uncontrolled OS cache
and does not match one current reference role. It locates hotspots but cannot by itself prove
improvement. Paired runs against the corrected baseline reduce time/order noise and prevent faster
but incorrect candidates from passing.

**Alternatives considered**: a single before/after run is too noisy; aggregate-only gates hide
single-book regressions; synthetic-only benchmarks do not represent real MinerU structures.
