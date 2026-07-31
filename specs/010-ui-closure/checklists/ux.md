# UI Requirements Checklist: UI Correctness and Shell Closure

**Purpose**: Ensure the compact specification is sufficient for implementation review
**Created**: 2026-07-31
**Feature**: [spec.md](../spec.md)

## Scope And Clarity

- [x] CHK001 Are the affected reader, detail, management, and library surfaces explicitly bounded? [Completeness, Spec §Goal]
- [x] CHK002 Is the reader heading requirement measurable without prescribing new publishing markup? [Clarity, Spec §FR-001]
- [x] CHK003 Are the detail cover fallback and TOC budget unambiguous? [Clarity, Spec §FR-003–FR-004]
- [x] CHK004 Are narrow- and wide-screen dialog expectations both defined? [Coverage, Spec §FR-006]
- [x] CHK005 Is the management navigation scope and current-location rule explicit? [Clarity, Spec §FR-007]

## Security And Regression Boundaries

- [x] CHK006 Are anonymous and administrator enhancement outcomes both specified? [Coverage, Spec §FR-009]
- [x] CHK007 Is public HTML and cache independence stated as an objective requirement? [Measurability, Spec §FR-010]
- [x] CHK008 Are publishing, schema, KaTeX, M2/M3, and broad redesign changes explicitly excluded? [Consistency, Spec §Out of Scope]

## Notes

- Standard-depth author/reviewer checklist; no unresolved requirement gap found.

## Import And Task Feedback

- [x] CHK009 Is the selected-file presentation specified as exactly one accessible identity? [Clarity, Spec §FR-012]
- [x] CHK010 Are upload, acceptance, queue, worker, and terminal states all covered as one journey? [Completeness, Spec §FR-013]
- [x] CHK011 Does the specification distinguish determinate from indeterminate progress without inventing completion? [Consistency, Spec §FR-014]
- [x] CHK012 Is the task subject fallback order defined before a book title exists? [Coverage, Spec §FR-015–FR-016]
- [x] CHK013 Are privacy and authority boundaries for the ZIP display name explicit? [Security, Spec §FR-016]
- [x] CHK014 Are failure, retry, cancellation, and quiet-success behaviors preserved? [Regression, Spec §FR-008]
