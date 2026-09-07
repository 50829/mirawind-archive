# Specification Quality Checklist: Permanent Deletion Safety

**Purpose**: Validate that the requirements define an unambiguous, irreversible and
recoverable-to-completion deletion contract before implementation.

**Created**: 2026-07-26

**Feature**: [spec.md](../spec.md)

## Product boundary

- [x] CHK001 Is the point at which deletion becomes irreversible explicitly defined?
  [Spec §FR-006; Assumptions]
- [x] CHK002 Does the specification explicitly exclude recycle bin, restore, delayed
  retention and batch deletion? [Spec §FR-022; Out of Scope]
- [x] CHK003 Is the permitted residual evidence defined positively and by forbidden content,
  rather than merely described as “minimal”? [Spec §FR-017–FR-018]
- [x] CHK004 Is alias reuse behavior defined independently from physical cleanup completion?
  [Spec §FR-006; §FR-020]

## Deliberate authorization

- [x] CHK005 Are authentication, administrator authorization, origin protection and
  recent-reauth behavior each explicit? [Spec §FR-001; §FR-004]
- [x] CHK006 Is title comparison precise for Unicode normalization, case, punctuation and
  whitespace? [Spec §FR-003; Edge Cases]
- [x] CHK007 Are stale confirmation, changed state and duplicate submission requirements
  separately defined? [Spec §FR-003; §FR-005]
- [x] CHK008 Is private-information disclosure behavior specified for unauthorized, absent,
  deleting and deleted subjects? [Spec §FR-007–FR-008; NFR-001]

## Visibility and cache boundary

- [x] CHK009 Does “every surface” enumerate libraries, details, reading, search, resources,
  originals, previews and management mutations? [Spec §FR-007]
- [x] CHK010 Does the cache contract prevent stale validators from returning success or 304
  after the barrier? [Spec §FR-008]
- [x] CHK011 Does the specification require both public and administrator route/search
  evidence? [Spec §SC-002]
- [x] CHK012 Is public indexing behavior covered for all deletion response classes?
  [Spec §NFR-001]

## Concurrency and task ownership

- [x] CHK013 Are indirect job relationships through imports, sources, configurations and
  versions included? [Spec §FR-009]
- [x] CHK014 Are queued cancellation, running termination and finalizer rejection all
  independently required? [Spec §FR-009–FR-010]
- [x] CHK015 Is publication-versus-deletion transaction ordering defined for either winner?
  [Spec User Story 2, scenario 3]
- [x] CHK016 Do retry, recovery and reconciliation requirements prevent recreation after
  deletion? [Spec §FR-010; §FR-019]

## Destructive storage safety

- [x] CHK017 Are book trees, retained uploads and inactive staging directories all in the
  required cleanup inventory? [Spec §FR-012]
- [x] CHK018 Are containment, root refusal, missing targets and symbolic links explicitly
  covered? [Spec §FR-014; Edge Cases]
- [x] CHK019 Is the required file-before-database order and its retry rationale stated?
  [Spec §FR-015–FR-016]
- [x] CHK020 Is final database removal defined broadly enough to include every content and
  derived record class? [Spec §FR-013]

## Failure, operations and measurable evidence

- [x] CHK021 Are all meaningful crash boundaries named, including after files but before the
  database commit? [Spec §NFR-005]
- [x] CHK022 Are safe error/task/log data limits explicit and content exclusions enumerated?
  [Spec §FR-018; NFR-007]
- [x] CHK023 Are acceptance latency, cleanup timeout and reader latency measurable?
  [Spec §NFR-002–NFR-003; NFR-006]
- [x] CHK024 Are migration, foreign-key, compatibility and repeat-run requirements explicit?
  [Spec §NFR-004]
- [x] CHK025 Are keyboard, naming, focus, confirmation and mobile accessibility requirements
  measurable? [Spec §NFR-008]
- [x] CHK026 Does completion require zero content/files and exactly one approved tombstone?
  [Spec §SC-005]

## Notes

- Review completed against `spec.md`, `plan.md`, `data-model.md` and both contracts.
- No unresolved requirement ambiguity remains. Implementation details are tracked in
  `tasks.md`, not in this requirements-quality checklist.
