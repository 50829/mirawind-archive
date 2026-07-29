# Tasks: Publishing Pipeline Performance

**Input**: Design documents from `specs/008-publishing-pipeline-performance/`

**Tests**: Tests precede implementation for architecture, compilation complexity, worker protocol,
candidate lifecycle, publication, authorization/cache, recovery and real-book performance.

**Organization**: User-story phases follow the execution dependency imposed by the architecture and
clean switch. US4 is delivered before the P1 runtime stories because its boundaries are required to
change the pipeline without recreating coupling. US1 and US2 form one uncommitted clean-switch batch;
the old and new publication job paths must not coexist in a commit.

## Phase 1: Setup - Reproducible Evidence

**Purpose**: Freeze inputs and make measurements machine-verifiable before optimization.

- [x] T001 Add failing result-schema and environment-binding tests for paired runs in `tests/unit/benchmarks/pipeline-paired.test.ts`
- [x] T002 [P] Add failing statistical tests for AB/BA/AB medians, CV expansion, single-book regression and RSS gates in `tests/unit/benchmarks/paired-statistics.test.ts`
- [x] T003 [P] Add failing fixture/reference preflight tests for exactly fifteen hash-bound inputs in `tests/unit/benchmarks/reference-preflight.test.ts`
- [x] T004 Implement versioned paired-result parsing and statistics in `scripts/benchmarks/paired-statistics.ts`
- [x] T005 Implement baseline/candidate worktree orchestration, randomized fixture order and isolated data roots in `scripts/benchmarks/pipeline-paired.ts`
- [x] T006 Extend environment and pipeline profiles with commit, dirty state, lockfile, runtime, filesystem, resource counts, stage timings and process-tree RSS in `scripts/benchmarks/environment.ts` and `scripts/benchmarks/pipeline-profile.ts`
- [x] T007 Add `benchmark:pipeline-paired` and `benchmark:compilation-complexity` commands in `package.json`
- [x] T008 Run the current reference preflight and preserve the frozen `c176fdd` baseline identity in ignored `.cache/008-publishing-performance/baseline.json`

**Checkpoint**: The runner rejects unbound/noisy/incorrect evidence and can reproduce the old result
without claiming an optimization.

---

## Phase 2: Foundational - Canonical Imports and Architecture Gate

**Purpose**: Make the target dependency rules enforceable before moving business code.

**CRITICAL**: All later source movement and runtime work depends on this phase.

- [x] T009 Add failing production-bundle tests proving `@/` imports work in worker and CLI output in `tests/integration/deployment/process-bundle.test.ts`
- [x] T010 [P] Add forbidden-edge, deep-import, relative-import, type-only, dynamic-import, cycle and coupling fixtures under `tests/fixtures/architecture/`
- [x] T011 Add failing architecture-graph tests for every negative fixture and the real source tree in `tests/architecture/dependency-graph.test.ts`
- [x] T012 Configure the existing Vite toolchain to bundle Node worker/CLI entries with `@/` resolution in `vite.processes.config.ts` and `tsconfig.processes.json`
- [x] T013 Replace process build/start scripts with the bundled entries while retaining strict typecheck in `package.json`
- [x] T014 Implement TypeScript/Astro import extraction, alias resolution, shortest paths, SCC detection and coupling metrics in `scripts/architecture/dependency-graph.ts`
- [x] T015 Define module directions, twelve-import/eight-port limits and zero final exceptions in `scripts/architecture/boundaries.ts`
- [x] T016 Add fast canonical-import editor feedback and the full graph command to standard lint in `eslint.config.js` and `package.json`
- [x] T017 Convert process entrypoint imports needed to pass the production alias smoke test in `src/worker/index.ts` and `src/cli/index.ts`

Phase 2 evidence: canonical import scan reported zero replacements; the complete 205-file source
graph reported zero diagnostics; all twelve positive/negative architecture tests, the production
process bundle smoke test, 639 Vitest tests, format, lint, typecheck and the production build passed.

**Checkpoint**: `pnpm lint`, typecheck and production process smoke tests prove canonical aliases and
reject every architecture violation class.

---

## Phase 3: User Story 4 - Change Without Hidden Coupling (Priority: P2, Enabling)

**Goal**: Establish business-first `core/application/adapters` boundaries without changing output.

**Independent Test**: The full source graph has zero forbidden edges/cycles/coupling violations and
existing compiler/publication parity tests remain byte/semantic equivalent.

### Tests for User Story 4

- [x] T018 [P] [US4] Add module-public-surface contract tests for publishing, reader, catalog and identity in `tests/contract/module-public-surfaces.test.ts`
- [x] T019 [P] [US4] Add behavior snapshots around existing configured-document, Reader model, catalog projection and auth use cases in `tests/integration/architecture/behavior-equivalence.test.ts`
- [x] T020 [P] [US4] Add discriminated worker-command validator tests, including old nullable-bag rejection fixtures, in `tests/contract/worker-command-union.test.ts`

### Implementation for User Story 4

- [x] T021 [P] [US4] Create publishing application ports and the only cross-module surface in `src/modules/publishing/application/ports/` and `src/modules/publishing/application/public.ts`
- [x] T022 [P] [US4] Create reader, catalog and identity application public surfaces in `src/modules/reader/application/public.ts`, `src/modules/catalog/application/public.ts` and `src/modules/identity/application/public.ts`
- [x] T023 [US4] Move hostile-input and content-preparation pure logic from `src/compiler/archive/` and `src/compiler/preprocess/` into `src/modules/publishing/core/preparation/` using `@/` imports
- [x] T024 [US4] Move document, render, resource and search pure logic from `src/compiler/` into `src/modules/publishing/core/publication/` without forwarding exports
- [x] T025 [US4] Separate ReaderPageModel/server artifact behavior into `src/modules/reader/core/` and `src/modules/reader/application/`, keeping React/static shell presentation in `src/web/features/reader/`
- [x] T026 [US4] Move public library/version presentation queries into `src/modules/catalog/application/` and `src/modules/catalog/adapters/sqlite/`
- [x] T027 [US4] Move administrator/authentication use cases behind identity ports in `src/modules/identity/application/` and adapters in `src/modules/identity/adapters/`
- [x] T028 [US4] Move business SQL mappings from `src/db/repositories/` into each owning module's `adapters/sqlite/`, leaving connection/transaction primitives in `src/platform/sqlite/`
- [x] T029 [US4] Move business storage paths and durability adapters into module `adapters/filesystem/`, leaving generic fsync/atomic/path primitives in `src/platform/filesystem/`
- [x] T030 [US4] Replace `FrozenJobInput` with a discriminated command union and registry in `src/entrypoints/worker/protocol.ts` and `src/entrypoints/worker/job-registry.ts`
- [x] T031 [US4] Move worker and CLI runtime handlers into `src/entrypoints/worker/` and `src/entrypoints/cli/`, then assemble adapters only in `src/composition/worker.ts` and `src/composition/cli.ts`
- [x] T032 [US4] Add the server composition root and make Astro controllers call application public surfaces in `src/composition/server.ts` and `src/pages/`
- [x] T033 [US4] Move React components/controllers/presenters into `src/web/` ownership and replace direct repository/storage imports in `src/components/` and `src/pages/`
- [x] T034 [US4] Delete empty legacy `src/compiler/`, `src/services/`, business `src/db/repositories/`, old `src/worker/` and forwarding files after all consumers move
- [x] T035 [US4] Run equivalence, architecture, format, lint, typecheck, unit, contract, integration and build gates; record the behavior-preserving checkpoint in `specs/008-publishing-pipeline-performance/tasks.md`

Phase 3 evidence: publishing, reader, catalog and identity expose one application public surface;
Astro pages and process entrypoints no longer import module adapters directly; the complete 222-file
source graph and fourteen architecture fixtures report zero diagnostics. Configured-document,
Reader navigation, catalog projection and Passkey policy snapshots remain equivalent. Format, lint,
typecheck, the production process bundle, the complete Astro/Vite production build and 633 Vitest
tests passed.

**Checkpoint**: Commit as `refactor(architecture): establish acyclic module boundaries` only after
all old ownership directories are gone and no behavior snapshot changed.

---

## Phase 4: User Story 1 - Reach a Trustworthy Preview Sooner (Priority: P1)

**Goal**: Compile one whole-book model and stream a complete candidate preview without duplicate or
superlinear content work.

**Independent Test**: All fifteen revisions produce reference-exact ready candidate previews;
source-region complexity is below the scale gate and accepted-to-preview improves without RSS or
single-book regression.

### Tests for User Story 1

- [x] T036 [P] [US1] Add 500/1,000/2,000/4,000 root source-region complexity and exact-output tests in `tests/unit/publishing/source-regions-complexity.test.ts`
- [x] T037 [P] [US1] Add typography single-pass, protected-byte and diagnostic-offset regression tests in `tests/unit/publishing/typography-builder.test.ts`
- [x] T038 [P] [US1] Add page-plan range coverage, heading/page lookup and no-page-AST-copy tests in `tests/unit/publishing/compiled-book.test.ts`
- [x] T039 [P] [US1] Add ordered four-page backpressure, bounded retention, deterministic diagnostics and cancellation tests in `tests/unit/publishing/render-pages.test.ts`
- [x] T040 [P] [US1] Add strict `BuildCandidateCommand` and bounded `CandidateBuildArtifact` contract tests in `tests/contract/build-candidate-protocol.test.ts`
- [x] T041 [P] [US1] Add candidate preview auth, sandbox resource, cache/noindex and semantic-page integration tests in `tests/integration/publication/candidate-preview.test.ts`

### Implementation for User Story 1

- [x] T042 [US1] Replace repeated UTF-16-prefix conversions with one internal UTF-8 offset index in `src/modules/publishing/core/preparation/source-text-index.ts`
- [x] T043 [US1] Linearize source-region exclusion and block mapping with ordered interval traversal in `src/modules/publishing/core/preparation/source-regions.ts`
- [x] T044 [US1] Apply typography edits and byte diagnostics through one output builder pass in `src/modules/publishing/core/preparation/typography.ts`
- [x] T045 [US1] Build heading, block, range and page maps once inside `compileBook()` in `src/modules/publishing/core/publication/compile-book.ts`
- [x] T046 [US1] Represent pagination only as ordered `PagePlan` block intervals and IDs in `src/modules/publishing/core/publication/compiled-book.ts`
- [x] T047 [US1] Replace pagination, outline, structure-proposal and manifest lookup rescans with the shared internal indexes in `src/modules/publishing/core/preparation/structure-proposal.ts`, `src/modules/publishing/core/publication/compile-book.ts` and `src/modules/publishing/core/publication/manifest.ts`
- [x] T048 [US1] Implement the ordered at-most-four-page async generator with cancellation probes in `src/modules/publishing/core/publication/render-pages.ts`
- [x] T049 [US1] Materialize preview/public ReaderShell policies and incremental search/manifest spools from each route-neutral page in `src/modules/publishing/adapters/reader-html/candidate-materializer.ts`
- [ ] T050 [US1] Implement strict command/artifact types and validators in `src/modules/publishing/application/commands/build-candidate.ts` and `src/entrypoints/worker/protocol.ts`
- [ ] T051 [US1] Implement the isolated child candidate builder and stage telemetry in `src/entrypoints/worker/handlers/build-candidate.ts`
- [ ] T052 [US1] Add bounded current-candidate fields to draft queries and workbench DTOs in `src/modules/publishing/application/queries/get-draft.ts` and `src/web/contracts/publishing.ts`
- [ ] T053 [US1] Run microbenchmarks and fifteen reference comparisons, then record pre-cutover compilation evidence in `docs/audits/008-compilation-performance.md`

Phase 4 linearization checkpoint evidence: source-region 1,000/4,000-root medians changed from
19.08/298.46 ms (15.64x) to 0.94/2.19 ms (2.34x). The typography 4,000-paragraph median changed
from approximately 411 ms to 146 ms and its 1,000-to-4,000 growth is 3.44x. Range-only page plans,
whole-book lookup maps and ordered four-page rendering are active in both existing preview and
publication builds; the old configured-document/page-copy implementation is deleted. Format, lint,
typecheck, 660 Vitest tests, architecture checks and the production build pass. All fifteen local
ZIP bindings pass hash/size preflight and the frozen observed-v2 set remains 15/15 reference exact.
This does not replace T053: candidate-code fifteen-book compilation and paired AB/BA/AB evidence are
still required after a committed checkpoint.

The indexed structure-proposal checkpoint changed the 1,000/4,000-heading medians from
144.00/1,724.98 ms (11.98x) to 41.82/136.68 ms (3.27x). A fresh current-code observation of all
fifteen real books is 15/15 reference-v2 exact; this run also added a regression for restoring an
explicit body role when a nested chapter follows appendix material inside a part. Pagination now
finds first headings without page slices and manifest resource IDs use one position index instead of
rescanning every reference for every block.

Candidate page materialization now renders each page once with validated logical heading/resource
tokens, rewrites only parsed HTML URL attributes, and emits preview/public ReaderShell documents
from the same route-neutral body. Page bodies remain disk-backed until the shared renderer CSS is
known, then are read and released one at a time. Manifest page records and search rows are buffered
to incremental NDJSON spools; integration evidence compares every emitted search row with the
existing canonical spool and verifies preview authorization signing, private no-store/noindex
policy, disabled public-only capabilities, semantic-page parity and temporary-body cleanup.

**Checkpoint**: Candidate core is reference-exact and measurably linear but is not yet a second
user-selectable runtime path. Do not commit the cutover until US2 removes both old job kinds.

---

## Phase 5: User Story 2 - Publish Exactly What Was Previewed (Priority: P1)

**Goal**: Cleanly activate `build_candidate` and synchronously promote the exact ready candidate.

**Independent Test**: Preview/public normalized content and semantic digests match for all fifteen
books, publish runs no compile/render stage, and repeat/stale requests preserve one atomic result.

### Tests for User Story 2

- [ ] T054 [P] [US2] Add clean-baseline schema tests for candidate/job/version invariants and old job-kind rejection in `tests/integration/storage/candidate-baseline.test.ts`
- [ ] T055 [P] [US2] Add draft PATCH and draft projection contract tests for one current candidate attempt in `tests/contract/manage-draft-candidate.test.ts`
- [ ] T056 [P] [US2] Add synchronous publish, repeat success, stale candidate, policy, blocking diagnostic and audit tests in `tests/integration/publication/promote-candidate.test.ts`
- [ ] T057 [P] [US2] Add preview/public semantic digest and normalized DOM parity tests in `tests/integration/publication/candidate-parity.test.ts`
- [ ] T058 [P] [US2] Add browser coverage for save/build/ready/publish and removal of publish-job monitoring in `tests/e2e/publishing-workbench.spec.ts`

### Implementation for User Story 2

- [ ] T059 [US2] Revise the single database baseline for `draft_candidates`, `build_candidate`, candidate linkage, discarded versions and uniqueness constraints in `src/platform/sqlite/migrations/0001_clean_slate.sql`
- [ ] T060 [US2] Implement one transaction that saves a revision, creates its current attempt and enqueues `build_candidate` in `src/modules/publishing/adapters/sqlite/draft-candidate-repository.ts`
- [ ] T061 [US2] Implement candidate-tree durability and the atomic ready registration of version/search/presentation/candidate/job in `src/modules/publishing/application/commands/finalize-candidate.ts`
- [ ] T062 [US2] Make draft PATCH perform bounded patch/schema/reference validation only and return the candidate contract in `src/modules/publishing/application/commands/save-draft.ts` and `src/pages/api/manage/books/[bookId]/draft.ts`
- [ ] T063 [US2] Implement policy/CAS/idempotent synchronous candidate promotion and audit in `src/modules/publishing/application/commands/publish-candidate.ts`
- [ ] T064 [US2] Replace the publish endpoint's job creation response with the synchronous promotion contract in `src/pages/api/manage/books/[bookId]/publish.ts`
- [ ] T065 [US2] Update workbench candidate state, progress and publish handling without changing its design in `src/web/components/manage/PublishingWorkbench.tsx`
- [ ] T066 [US2] Switch worker dispatch/state phases/retry policy to `build_candidate` in `src/entrypoints/worker/job-registry.ts` and `src/modules/publishing/application/commands/job-state.ts`
- [ ] T067 [US2] Advance compiler/renderer/preview identities and align version/manifest validation in `src/modules/publishing/core/publication/identities.ts`
- [ ] T068 [US2] Delete old preview/publish handlers, version builder, preview tree authority, job kinds, protocol shapes, tests and imports under `src/` and `tests/`
- [ ] T069 [US2] Prove no old symbol/path/runtime remains with architecture search, full contract/integration/build tests and fifteen parity comparisons, recording the cutover in `docs/audits/008-candidate-cutover.md`

**Checkpoint**: Commit T059-T069 with the prepared US1 candidate activation as
`refactor(publishing)!: switch to immutable candidate builds`. No commit may contain two usable
publication paths.

---

## Phase 6: User Story 3 - Recover Every Interrupted Build (Priority: P1)

**Goal**: Give every candidate attempt a deterministic terminal or reclaimable state across crashes,
cancellation, retries, deletion and stale completion.

**Independent Test**: Fault injection at every durable boundary leaves the old public version plus
exactly one registered candidate or one reclaimable orphan; retry creates a new attempt and cannot
publish stale output.

### Tests for User Story 3

- [ ] T070 [P] [US3] Add crash injection before/after file sync, rename, ready transaction and promotion commit in `tests/integration/recovery/candidate-crash-boundaries.test.ts`
- [ ] T071 [P] [US3] Add stale completion, newer revision, retry, cancellation grace and bounded-progress tests in `tests/integration/recovery/candidate-attempts.test.ts`
- [ ] T072 [P] [US3] Add upload/source/config/candidate orphan and restart reconciliation tests in `tests/integration/recovery/publishing-orphans.test.ts`
- [ ] T073 [P] [US3] Add delete-versus-build/publish tests proving hidden state and permanent cleanup remain authoritative in `tests/integration/deletion/candidate-deletion.test.ts`

### Implementation for User Story 3

- [ ] T074 [US3] Enforce current-attempt compare-and-set and deterministic stale discard in `src/modules/publishing/application/commands/finalize-candidate.ts`
- [ ] T075 [US3] Implement retry as a new candidate/job identity with preserved safe terminal evidence in `src/modules/publishing/application/commands/retry-candidate.ts`
- [ ] T076 [US3] Extend reconciliation across uploads, source/config revisions and candidate/version trees without automatic promotion in `src/modules/publishing/application/commands/reconcile-publishing.ts`
- [ ] T077 [US3] Integrate cancellation, timeout, lease loss and interruption terminalization with candidate cleanup in `src/entrypoints/worker/runner.ts`
- [ ] T078 [US3] Make book deletion cancel current attempts and prevent late finalization/promotion in `src/modules/catalog/application/commands/delete-book.ts`
- [ ] T079 [US3] Run the complete crash matrix and document each filesystem/database state and recovery outcome in `docs/audits/008-candidate-recovery.md`

**Checkpoint**: Commit as `refactor(publishing): make candidate recovery deterministic` after every
injected boundary passes.

---

## Phase 7: User Story 5 - Keep Reading Responsive During Builds (Priority: P2)

**Goal**: Keep immutable reading and search responsive while large candidate work is active.

**Independent Test**: At least 200 overlapping uncached page requests retain p95 at most 300 ms,
search p95 remains below 1,000 ms, and old/private/missing resources preserve authorization behavior.

### Tests for User Story 5

- [ ] T080 [P] [US5] Add manifest cold-load single-flight and O(1) page/alias/resource lookup tests in `tests/unit/reader/version-artifact-index.test.ts`
- [ ] T081 [P] [US5] Add public/private/old/missing resource authorization and cache tests during candidate builds in `tests/integration/http/reader-build-concurrency.test.ts`
- [ ] T082 [P] [US5] Extend concurrent benchmark assertions to separate page, resource and search p95 in `tests/unit/benchmarks/read-during-build.test.ts`

### Implementation for User Story 5

- [ ] T083 [US5] Implement promise single-flight and immutable page/alias/resource maps in `src/modules/reader/adapters/filesystem/version-artifact-index.ts`
- [ ] T084 [US5] Route pages, resources, originals and search through reader application queries only in `src/modules/reader/application/queries/`
- [ ] T085 [US5] Stream authorized preview/public resources from validated manifest metadata without full-file buffering in `src/modules/reader/adapters/filesystem/read-resource.ts`
- [ ] T086 [US5] Reuse one validated source/resource inventory through candidate assembly while preserving closure hashes and fsync rules in `src/modules/publishing/adapters/filesystem/candidate-inventory.ts`
- [ ] T087 [US5] Extend the benchmark runner to overlap candidate builds with page/resource/search traffic in `scripts/benchmarks/read-during-build.ts`
- [ ] T088 [US5] Run authorization/cache suites and the concurrent reader gate, recording results in `docs/audits/008-reader-concurrency.md`

**Checkpoint**: Commit as `perf(reader): bound artifact loading and candidate io`.

---

## Phase 8: Polish, Formal Performance and Convergence

**Purpose**: Prove the complete goal, remove remnants and synchronize all evidence.

- [ ] T089 [P] Add final hostile archive/image, compiler identity and download/cache regression coverage in `tests/integration/archive/`, `tests/integration/compiler/` and `tests/integration/http/`
- [ ] T090 Measure analyze-to-prepare sealed extraction reuse against lifecycle/crash requirements, record acceptance or rejection in `docs/audits/008-sealed-extraction.md`, and implement accepted reuse in `src/modules/publishing/adapters/filesystem/sealed-extraction.ts`
- [ ] T091 Run the 500-page synthetic stress book and 2,000/20,000 structure bounds, saving machine-readable output under ignored `.cache/008-publishing-performance/`
- [ ] T092 Run the formal fifteen-book AB/BA/AB paired benchmark, expanding to five pairs on CV above 10%, under ignored `.cache/008-publishing-performance/paired.json`
- [ ] T093 Validate all SC-001-SC-010 thresholds from the paired result and publish the bounded report in `docs/audits/008-publishing-performance.md`
- [ ] T094 Remove obsolete directories, forwarding files, old identities, old benchmark formats and unconsumed fixtures identified by `rg` and the dependency graph under `src/`, `tests/` and `scripts/`
- [ ] T095 Run `format`, lint/architecture, typecheck, unit, contract, integration, E2E, build, hostile-input, recovery, reference, stress and benchmark gates from `specs/008-publishing-pipeline-performance/quickstart.md`
- [ ] T096 Synchronize current behavior and evidence in `docs/product/product-spec.md`, `docs/decisions/decision-log.md`, `docs/operations/`, `docs/audits/` and `specs/008-publishing-pipeline-performance/`
- [ ] T097 Run Spec Kit analyze, resolve every CRITICAL/HIGH inconsistency, then run converge and append any real residual work to `specs/008-publishing-pipeline-performance/tasks.md`
- [ ] T098 Complete any converged tasks, rerun the affected gates, and record the clean completion state in `specs/008-publishing-pipeline-performance/tasks.md`

**Checkpoint**: Commit evidence as `test(publishing): close recovery and performance gates`. The
feature is complete only when the formal result satisfies every threshold and Spec Kit reports no
unmitigated CRITICAL finding.

---

## Dependencies and Execution Order

### Phase Dependencies

```text
Setup evidence
      ↓
Alias + architecture foundation
      ↓
US4 behavior-preserving module migration
      ↓
US1 compile/index/candidate core
      ↓
US2 single clean switch and synchronous publish
      ↓
US3 recovery ─────┐
                  ├──> formal paired benchmark and convergence
US5 reader/I/O ───┘
```

- Phase 1 establishes evidence and does not change runtime behavior.
- Phase 2 blocks all source migration because `@/` must work in production processes first.
- US4 blocks pipeline changes by making the dependency direction enforceable.
- US1 and US2 are implemented consecutively and committed together at the runtime cutover.
- US3 and US5 may proceed in parallel after the clean switch because they own different adapters.
- Phase 8 depends on every user story and uses committed baseline/candidate states.

### Parallel Opportunities

- T001-T003, T009-T011 and T018-T020 are independent test authoring groups.
- Publishing, reader, catalog and identity public surfaces (T021-T022) can be prepared in parallel.
- US1 unit/contract tests T036-T041 can be authored in parallel before implementation.
- US2 contract/integration/E2E tests T054-T058 can be authored in parallel.
- US3 recovery fixture classes T070-T073 can be authored independently.
- US5 reader unit/integration/benchmark tests T080-T082 can be authored independently.
- After US2, US3 and US5 implementation can proceed independently.

## Implementation Strategy

1. Establish measurement and dependency gates before refactoring.
2. Commit a behavior-preserving module migration with no semantic change.
3. Prove linear algorithms and bounded page rendering against references before activation.
4. Activate candidate schema/job/API/UI and delete both legacy job paths in one commit.
5. Close recovery and reader performance independently.
6. Run formal paired performance only on committed states; never optimize against a dirty one-off run.
7. Mark tasks complete incrementally and create Conventional Commits only at the documented logical
   checkpoints after their gates pass.
