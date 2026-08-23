# Research: Architecture Closure

## Decision 1: Check cycles at both file and module granularity

**Decision**: Retain the existing resolved file dependency graph and add an aggregated business-module
graph. Reject strongly connected components in either graph.

**Rationale**: The current 260-file graph reports no diagnostics, but legal public-surface imports
produce a Catalog-to-Publishing and Publishing-to-Catalog module cycle. A file SCC cannot see that
cycle because the forward and reverse paths end in different files.

**Alternatives considered**: Treating `application/public.ts` as an unconditional escape hatch leaves
the coupling invisible. Creating package workspaces would enforce boundaries but adds build and
versioning cost without independent deployment or reuse.

## Decision 2: Keep Publishing-to-Catalog as the presentation direction

**Decision**: Publishing owns validation and interpretation of version artifacts, maps them into a
bounded Catalog-owned presentation input, and invokes Catalog's writer/remover operations. Catalog
does not enumerate versions or parse publishing formats.

**Rationale**: Version state, paths, config and manifest identities are Publishing concerns;
presentation rows and current catalog display are Catalog concerns. This direction preserves the
single Catalog SQLite writer from D-119 without a reverse module dependency.

**Alternatives considered**: Moving the presentation table to Publishing contradicts its Catalog
read model ownership. Letting Catalog continue query `book_versions` and parse formats keeps the
module cycle. A new shared domain module would merely hide the coupling.

## Decision 3: Split capabilities by authority, not implementation class

**Decision**: Cancellation, removal inventory and publishing record purge are separate ports even if
one SQLite adapter implements them all.

**Rationale**: The filesystem deletion adapter currently receives purge authority merely to capture
an inventory. Narrow interfaces make each mutation path reviewable and prevent accidental use.

**Alternatives considered**: Keeping one broad cleanup service is fewer types but preserves excess
authority. Splitting into separate concrete adapters duplicates database setup and transaction use.

## Decision 4: Extract composition around lifecycle outcomes

**Decision**: Parent worker composition is split into input capture, attempt execution, completion,
recovery, loop, health reporting and bootstrap. Child dispatch uses its existing closed registry and
focused handler groups.

**Rationale**: `composition/worker.ts` currently has 865 lines and owns all seven lifecycle concerns;
`composition/job-child.ts` has 431 lines and hand-codes the seven-kind dispatch despite an existing
registry. Responsibilities and test seams, not line counts, justify the extraction.

**Alternatives considered**: Moving arbitrary function ranges into helper files would reduce length
without ownership. A generic workflow engine or external queue is unnecessary and prohibited.

## Decision 5: Return an attempt outcome before terminal mutation

**Decision**: The attempt executor owns heartbeat, abort and child lifetime and returns a bounded
outcome. One completion coordinator performs all generic, candidate and purge terminal mutations.

**Rationale**: This establishes one testable terminal-state authority while preserving the existing
specialized atomic transactions. It also lets unexpected exit, cancellation, timeout and shutdown
share the same observation and completion path.

**Alternatives considered**: Letting each handler finalize itself duplicates policy. Making the child
write terminal state permits a killed child to leave partially advanced lifecycle state.

## Decision 6: Extend the existing private worker health snapshot

**Decision**: One worker-side reporter atomically writes the latest checkpoint, queue state and
current/recent attempt observation to the existing `worker-health.json`. The authenticated health
route reads this file; Web request metrics remain process-local.

**Rationale**: `OperationalMetrics` is an in-memory singleton. Worker recordings and Web health reads
occur in different processes, so current queue/phase values are invisible. The existing private
health file is already the bounded cross-process observation surface.

**Alternatives considered**: Persisting metrics in SQLite adds write contention and a new retention
model. A Prometheus/OpenTelemetry service expands infrastructure. Logging every poll makes queue
state difficult to query and creates unbounded repetition.

## Decision 7: Sample process-tree RSS in the parent

**Decision**: On Linux, traverse the known child PID's `/proc/<pid>/task/<pid>/children` graph and sum
available `VmRSS` values every 250 ms without overlapping samples. Retain a nullable peak and treat
all races or unreadable files as unavailable, not zero.

**Rationale**: Child `process.memoryUsage()` excludes OCR/PDF descendants. Existing benchmark code
already proves the required host mechanism but converts missing processes to zero and is not used in
production. Parent sampling observes the complete isolated task tree without changing IPC.

**Alternatives considered**: Child self-RSS undercounts descendants. `ps` subprocesses add overhead
and parsing variability. cgroup metrics include the long-lived worker and unrelated activity.

## Decision 8: Validate progress monotonically within one phase

**Decision**: A repeated phase must retain its unit and known total and cannot decrease completed or
processed byte counts. A transition to a new valid phase may start a new progress scale.

**Rationale**: Protocol parsing checks each update independently but repository heartbeat currently
accepts decreasing updates. Stage observation needs a trustworthy monotonic sequence.

**Alternatives considered**: Silently clamping hides child defects. Enforcing monotonic completed
values across different phases is invalid because phase units and totals differ.

## Decision 9: Time declared phases only from their real entry points

**Decision**: Move each existing child progress transition to the start of the work it names before
using parent progress messages for production stage duration. Keep detailed parser, typography,
rendering and I/O micro-stages in the opt-in benchmark profiler.

**Rationale**: Analyze, preparation and candidate search currently report some phases only after the
corresponding work has completed. Timing those messages without realignment would create misleading
near-zero stages even though the clock implementation is correct.

**Alternatives considered**: Renaming phases would change the task protocol and UI. Always enabling
the detailed pipeline profiler would add unbounded artifacts and measure only child-self RSS.
