# Architecture And Observability Requirements Checklist: Architecture Closure

**Purpose**: Validate architecture, worker lifecycle and operational-observation requirements before
implementation and during PR review
**Created**: 2026-08-23
**Feature**: [spec.md](../spec.md)

## Requirement Completeness

- [x] CHK001 Are dependency requirements defined at both resolved-file and aggregated-business-module
      granularity? [Completeness, Spec §FR-001, NFR-001]
- [x] CHK002 Is the permitted direction between Reader, Publishing, Catalog and Identity explicitly
      documented rather than inferred from current imports? [Completeness, Plan §Design.1]
- [x] CHK003 Are all cross-module mutation classes in scope identified, including presentation,
      deletion cleanup and current-version recovery? [Coverage, Spec §FR-003]
- [x] CHK004 Are ownership requirements defined separately for input capture, execution, completion,
      recovery, health reporting and bootstrap? [Completeness, Spec §FR-004]
- [x] CHK005 Are observation requirements complete for empty, queued, running, draining, successful,
      failed, canceled, timed-out and interrupted states? [Coverage, Spec §US3, Edge Cases]
- [x] CHK006 Are both current and most-recent attempt retention requirements explicitly bounded?
      [Completeness, Data Model §Attempt Observation]

## Requirement Clarity

- [x] CHK007 Is “narrow application operation” clarified through explicit least-authority operations
      and prohibited data rather than subjective interface size? [Clarity, Spec §FR-001, FR-016]
- [x] CHK008 Is the distinction between composition wiring and business lifecycle policy precise enough
      to classify shared transaction setup, SQL and state-transition decisions? [Clarity, Spec §FR-004]
- [x] CHK009 Is the one-running-job constraint distinguished from the four-page in-flight rendering
      constraint so the two concurrency limits cannot be conflated? [Clarity, Spec §FR-011]
- [x] CHK010 Is same-phase monotonic progress defined for completed units, processed bytes, units and
      known/unknown totals? [Clarity, Research §Decision 8]
- [x] CHK011 Is process-tree RSS defined as the child plus all observable descendants, with unavailable
      distinguished from a measured zero? [Clarity, Spec §FR-007, FR-008]
- [x] CHK012 Is “bounded refresh interval” quantified for active attempts and idle/checkpoint state?
      [Clarity, Plan §Technical Context, Contract worker-observability]

## Requirement Consistency

- [x] CHK013 Does the module direction remain consistent with Catalog's sole presentation writer and
      Publishing's ownership of version artifact interpretation? [Consistency, D-119, D-123]
- [x] CHK014 Do server and worker composition requirements preserve the rule that only composition may
      assemble use cases with concrete adapters? [Consistency, D-117, Plan §Design.3]
- [x] CHK015 Are health snapshot additions consistent with the no-schema-change requirement and its
      explicitly derived, overwrite-only status? [Consistency, Spec §FR-015, Data Model]
- [x] CHK016 Are timeout observations consistent with the existing persisted terminal-state and retry
      semantics rather than introducing a new task state? [Consistency, Data Model §State Transitions]
- [x] CHK017 Do observation requirements preserve the existing separation between Web request metrics
      and worker process metrics? [Consistency, Research §Decision 6]

## Acceptance Criteria Quality

- [x] CHK018 Can zero module cycles and zero cross-module internal imports be objectively measured by
      the stated architecture evidence? [Measurability, Spec §SC-001]
- [x] CHK019 Can “exactly one declared application operation” be audited without counting internal
      helper calls or composition wiring as extra operations? [Measurability, Spec §SC-002]
- [x] CHK020 Is terminal-transition uniqueness measurable for each required outcome, including a child
      that exits between its last progress and result messages? [Measurability, Spec §SC-003]
- [x] CHK021 Are the wall, RSS, read and search regression thresholds tied to a declared workload and
      accepted baseline? [Acceptance Criteria, Spec §NFR-003, NFR-004]
- [x] CHK022 Is observation emission bounded by a numeric rate and unchanged-snapshot suppression?
      [Acceptance Criteria, Spec §SC-004, Contract worker-observability]

## Exception And Recovery Coverage

- [x] CHK023 Are requirements defined for database loss during idle observation and for health-file
      write failure without weakening task execution? [Gap, Spec §Edge Cases]
- [x] CHK024 Are requirements defined for RSS races caused by short-lived descendants and malformed or
      partially readable `/proc` files? [Coverage, Spec §FR-008, Edge Cases]
- [x] CHK025 Are recovery requirements explicit when a lease expires immediately before live completion
      attempts its terminal transaction? [Coverage, Spec §Edge Cases, FR-012]
- [x] CHK026 Are requirements defined for repeated entry into the same named phase within one attempt,
      including whether it creates one contiguous observation or multiple entries? [Clarity, Data Model]
- [x] CHK027 Are health snapshot size, maximum stage count and malformed/unknown-version behavior
      explicitly bounded? [Coverage, Contract worker-observability]

## Security And Privacy

- [x] CHK028 Are sensitive-data exclusions consistent across the health file, authenticated response,
      structured logs and errors? [Consistency, Spec §FR-009]
- [x] CHK029 Is authorization, private/no-store caching and non-indexing stated for the only response
      that exposes worker observations? [Coverage, Spec §FR-014, Contract worker-observability]
- [x] CHK030 Are opaque IDs and safe error classifications defined tightly enough to prevent original
      names, raw paths and content-bearing diagnostics from entering observations? [Clarity, Spec §SC-006]

## Dependencies And Assumptions

- [x] CHK031 Is Linux `/proc` availability explicitly limited to production evidence while non-Linux
      development behavior remains unavailable and non-fatal? [Assumption, Research §Decision 7]
- [x] CHK032 Is the assumption that health data needs no long-term retention consistent with operator
      needs and the exclusion of external telemetry? [Assumption, Spec §Assumptions, Out of Scope]
- [x] CHK033 Are existing decision and schema identities named as preserved boundaries so a mechanical
      refactor cannot silently trigger a compatibility change? [Dependency, Spec §FR-015]

## Notes

- This is a requirements-quality checklist, not an implementation test plan.
- Items should be resolved against the spec, plan, data model and contracts before code is accepted.
