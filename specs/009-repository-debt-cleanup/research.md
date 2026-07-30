# Research: Repository Debt Cleanup

## Decision 1: Split the overloaded maintenance task

**Decision**: Replace the internal `reclaim` kind with `reclaim_versions` and `purge_book`. Keep the
existing external status vocabulary through a direct, total mapping with no database lookup.

**Rationale**: The current kind requires worker dispatch, retry and serialization to inspect
`book_id` or `book_deletions` to discover what the task means. Distinct identities make phase sets,
commands and lifecycle effects closed by construction without changing task UI behavior.

**Alternatives considered**:

- Add a nullable subtype column: rejected because it preserves invalid combinations and another
  branch beside `kind`.
- Keep `reclaim` and centralize the lookup: rejected because the semantic ambiguity remains.
- Change the public status strings: rejected because no user-facing change is needed.

## Decision 2: Make book scope authoritative when it becomes known

**Decision**: `jobs.book_id` is the only deletion/cancellation scope for book-bound work. Initial
import analysis may be unbound; assigning an import to a book atomically scopes its existing jobs.

**Rationale**: The current relationship SQL follows import, source, version and captured-version
links in three places. It is expensive to understand and can drift whenever a new job field is added.
The stable opaque book ID already exists on every later workflow.

**Alternatives considered**:

- Continue deriving the scope from all foreign keys: rejected because this is the duplicated hidden
  coupling being removed.
- Add a separate job-to-book relation table: rejected because jobs have at most one owning book and
  the existing nullable field is sufficient.
- Require a book before upload: rejected because a new import legitimately creates its book later.

## Decision 3: Coordinate deletion through ports, not cascading ownership

**Decision**: Catalog owns deletion policy/tombstones/books; Publishing owns its task and publishing
records. Catalog application uses one narrow Publishing cleanup port and a shared transaction supplied
by composition for accept, terminal outcome, retry and final purge.

**Rationale**: The final delete must retain a tombstone and task result while deleting a graph with
cycles between books, jobs, candidates and versions. Blind `ON DELETE CASCADE` would either delete the
required operational result or require equally complex detach rules. Explicit owners keep the current
behavior and make future schema changes local.

**Alternatives considered**:

- Let Catalog continue deleting every table: rejected because it encodes Publishing's schema.
- Let Publishing own `book_deletions`: rejected because deletion confirmation and the tombstone are
  Catalog lifecycle behavior.
- Create a new global background-task module: rejected because it moves many stable files and adds a
  fifth business boundary to solve one known cross-module workflow.
- Replace the final purge with cascades: rejected because retained task/tombstone semantics and cyclic
  pointers still require explicit ordering.

## Decision 4: Keep one SQL writer for version presentations

**Decision**: The Catalog presentation repository is the sole insert implementation and exposes a
narrow writer through Catalog application. Candidate registration receives it from composition;
reconciliation and recovery use the same repository.

**Rationale**: The current duplicate SQL statements can drift when projection fields change. The
projection is a Catalog read model, while Publishing only needs a writer participating in its existing
registration transaction.

**Alternatives considered**:

- Move the table entirely into Publishing: rejected because Catalog owns the projection model and its
  query/reconciliation behavior.
- Keep a private duplicate for transaction convenience: rejected because the existing transaction
  wrapper supports injected adapter calls inside one outer transaction.
- Introduce an event bus: rejected as unnecessary infrastructure on a single process/database.

## Decision 5: Production tests use the production baseline

**Decision**: Replace the partial job schema helper in three recovery test files with the existing
migrated test database helper and open the concurrency tests' second connection against that file.
Delete all table-presence probes and missing-table behavior from production.

**Rationale**: The helper is consumed only by tests and omits foreign keys, indexes and related tables.
Production branches exist solely to satisfy that artificial environment. The complete baseline is
fast enough and tests the real contract.

**Alternatives considered**:

- Move the partial schema helper into tests: rejected because production would still require the
  missing-table branches.
- Add dependency injection flags to disable lifecycle effects: rejected because that creates another
  test-only production mode.
- Add tests asserting the helper is absent: rejected because behavior, not absence, is the evidence.

## Decision 6: Dead-code cleanup requires direct evidence

**Decision**: Delete files with no source, test, script or framework consumer; make internal-only
exports private; retain framework method exports, current runtime singleton reset hooks and staged
content modules. Do not add a permanent dead-export gate in this feature.

**Rationale**: Static name counts have false positives for Astro routes and reflection. The audit found
two unreferenced production files and a bounded set of internal-only exports, which can be reviewed
directly. A new tool or broad gate would cost more than the present residue.

**Alternatives considered**:

- Install and enforce a new dead-code analyzer: rejected because configuration and framework false
  positives would add maintenance overhead.
- Delete every `ForTests` function: rejected because three hooks reset real process-local caches in
  route integration tests and are not dead.
- Split all large files: rejected because line count alone does not identify ownership or behavior
  debt.

## Decision 7: Remove local output only after retaining durable evidence

**Decision**: Delete ignored `.cache`, `test-results`, generated public/build outputs and test reports
after the accepted results are represented by tracked audit documents. Preserve `.env`, private real
fixtures and all pre-existing untracked research files.

**Rationale**: The ignored output is reproducible and currently consumes about 11 GiB. It is not part
of the repository source, while tracked 008 reports retain the accepted hashes and conclusions.

**Alternatives considered**:

- Keep all raw profiler directories indefinitely: rejected because most are intermediate experiments
  and are already ignored.
- Delete the whole fixture tree: rejected because real fixtures are user data and required for
  reference/performance validation.
- Commit raw output: rejected because of size, privacy and reproducibility concerns.

## Decision 8: Future capability comes from real boundaries only

**Decision**: Do not add metadata, folder, attachment or EPUB interfaces in 009. Preserve and expose
only the cleanup and presentation ports used by current flows.

**Rationale**: Empty future interfaces guess at data ownership before the M2/M5 requirements and would
be immediate dead code. Clean module ownership is the useful extension point.

**Alternatives considered**:

- Generalize `original_files` now: rejected because it changes schema and product behavior outside
  the cleanup.
- Add empty repository interfaces for every roadmap item: rejected as speculative abstraction.
