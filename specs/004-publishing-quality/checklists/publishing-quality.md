# Publishing Quality Requirements Checklist: Publishing Quality Closure

**Purpose**: Formal reviewer gate for the completeness, clarity, consistency and
measurability of printed-contents, preview-parity, renderer-asset and compatibility
requirements.

**Created**: 2026-07-25

**Feature**: [spec.md](../spec.md)

**Note**: This checklist evaluates the written requirements, not the implementation.

## Requirement Completeness

- [x] CHK001 Are the authoritative and derived representations explicitly distinguished,
  including the retained Markdown and excluded publication projection? [Completeness,
  Spec §FR-001, §FR-006]
- [x] CHK002 Are all consumers affected by a reference-only region enumerated rather than
  reducing the requirement to navigation? [Completeness, Spec §FR-006, §FR-023]
- [x] CHK003 Are both automatic proposal and administrator reversal requirements defined?
  [Completeness, Spec §FR-004–005]
- [x] CHK004 Are formula success, fallback, accessibility, asset and old-version outcomes
  all specified? [Completeness, Spec §FR-018–022]
- [x] CHK005 Are v1 read compatibility, v2 write behavior, migration, unknown versions and
  malformed data covered? [Completeness, Spec §FR-010–012]
- [x] CHK006 Are preview identity, stale preview, blocking diagnostics and publication
  rollback requirements all present? [Completeness, Spec §FR-013–017]

## Requirement Clarity

- [x] CHK007 Is “high confidence” quantified with entry count, exact match coverage,
  monotonicity and conflict criteria? [Clarity, Spec §FR-004]
- [x] CHK008 Is “bounded configuration” quantified for region and entry counts?
  [Clarity, Spec §FR-010]
- [x] CHK009 Are source ranges defined in a cross-runtime, Unicode-unambiguous unit and
  tied to exact hashes? [Clarity, Plan §Source-region configuration; Contract
  `book-config-v2.md`]
- [x] CHK010 Is “same preview and publication result” decomposed into pages, headings,
  numbering, body semantics and diagnostics? [Clarity, Spec §FR-013–015, SC-003]
- [x] CHK011 Is the difference between `include_in_toc` and `reference_only` explicit?
  [Clarity, Spec §FR-006–007]
- [x] CHK012 Is the one-visible-formula requirement distinguished from retention of
  accessible MathML? [Clarity, Spec §FR-019, SC-004]

## Requirement Consistency

- [x] CHK013 Do source-region requirements preserve the constitution’s Markdown and
  `book.yaml` authority without creating a second editable body? [Consistency, Spec
  §FR-001, §FR-010]
- [x] CHK014 Do ordinary TOC checkbox requirements remain consistent with D-048 while the
  separate source-region behavior follows D-101? [Consistency, Spec §FR-007]
- [x] CHK015 Do renderer-asset requirements preserve local self-hosting and avoid placing
  book resources in application static assets? [Consistency, Spec §FR-018, §FR-021]
- [x] CHK016 Do preview requirements preserve off-request-path compilation for both
  management and reading requests? [Consistency, Spec §NFR-001]
- [x] CHK017 Do repair requirements preserve immutable old versions and the sole current
  SQLite pointer? [Consistency, Spec §FR-022, §NFR-007]
- [x] CHK018 Are source filtering, resource closure and cross-reference rules ordered
  consistently so excluded resources cannot silently break active content? [Consistency,
  Contract `book-config-v2.md`]

## Acceptance Criteria Quality

- [x] CHK019 Can zero printed-contents contamination be objectively measured across body,
  navigation, outline, numbering, pages and search? [Measurability, Spec §SC-001]
- [x] CHK020 Can expected hierarchy and unchanged ambiguous structure be objectively
  compared with fixture expectations? [Measurability, Spec §SC-002]
- [x] CHK021 Can preview/publication parity be measured without requiring byte-identical
  authorization URLs or shells? [Measurability, Spec §SC-003]
- [x] CHK022 Can formula visibility, MathML accessibility and asset closure be observed as
  separate measurable outcomes? [Measurability, Spec §SC-004]
- [x] CHK023 Is migration success expressed as deterministic behavior for every supported
  v1 fixture? [Measurability, Spec §SC-005]
- [x] CHK024 Is the 300 ms target tied to the existing representative uncached workload and
  concurrent rebuild condition? [Measurability, Spec §SC-007, §NFR-002]

## Scenario and Edge-Case Coverage

- [x] CHK025 Are false-positive “目录” chapters, repeated labels, missing/reordered entries,
  multiple candidates and rich content addressed? [Coverage, Spec §Edge Cases]
- [x] CHK026 Are Unicode range boundaries, empty/overlapping/partial regions and
  wrong-source digests addressed? [Coverage, Spec §Edge Cases, §FR-012]
- [x] CHK027 Are region-to-active-content footnote, definition, resource and internal-link
  dependencies specified as blocking conflicts? [Coverage, Contract
  `book-config-v2.md`]
- [x] CHK028 Are invalid formulas, dense formula pages, missing assets and renderer identity
  mismatches addressed? [Coverage, Spec §Edge Cases]
- [x] CHK029 Are interruption, cancellation, retry, crash recovery and stale preview
  scenarios defined without weakening the old-version guarantee? [Recovery, Spec §FR-017,
  §NFR-007]
- [x] CHK030 Are acceptance and reversal usable without hundreds of individual heading
  edits? [Coverage, Spec §SC-008]

## Dependencies and Assumptions

- [x] CHK031 Is the reliance on existing archive security, authentication, authorization,
  publication and current-version rules explicit? [Dependency, Spec §Assumptions]
- [x] CHK032 Is the no-external-model assumption consistent with deterministic detection
  requirements? [Assumption, Spec §NFR-003]
- [x] CHK033 Is the KaTeX engine, generated asset closure and renderer identity dependency
  explicit enough to prevent markup/CSS version drift? [Dependency, Plan §Formula renderer
  assets; Contract `renderer-assets.md`]
- [x] CHK034 Are private real-fixture handling and opaque evidence requirements preserved?
  [Dependency, Spec §Assumptions, §NFR-008]

## Persisted Typography Preprocessing

- [x] CHK035 Is the preprocessing stage located after hostile-import validation and before
  accepted-source hashing, stable IDs and printed-contents analysis? [Ordering, Spec
  §FR-027, §FR-031]
- [x] CHK036 Is the normalized Markdown explicitly the one persisted body authority used by
  preview, publication, search and rebuilds? [Consistency, Spec §FR-027, §FR-031]
- [x] CHK037 Are immutable original uploads distinguished from temporary extracted Markdown
  and the normalized authoritative Markdown? [Authority, Spec §FR-033]
- [x] CHK038 Are all spacing and punctuation transformations closed, exact and objectively
  testable rather than described as generally “better” typography? [Clarity, Spec
  §FR-028–030]
- [x] CHK039 Are code, math, HTML, destinations and every named technical-token class
  protected? [Coverage, Spec §FR-028]
- [x] CHK040 Does the design require minimal source-slice replacement so non-target bytes
  and explicit line breaks remain unchanged? [Consistency, Spec §FR-031]
- [x] CHK041 Are idempotency, atomic persistence, bounded work and aggregate-only
  diagnostics measurable? [Measurability, Spec §NFR-009, §SC-009]
- [x] CHK042 Do v1 migration and new-import defaults have distinct, deterministic provenance
  profiles? [Compatibility, Spec §FR-026]
- [x] CHK043 Does explicit reprocessing create a new revision and invalidate stale preview
  without rewriting published versions? [Recovery, Spec §FR-033]
- [x] CHK044 Is it explicit that neither reader nor preview HTTP requests execute the
  preprocessor? [Performance, Spec §FR-027, §NFR-001]

## Notes

- Review completed after quantifying automatic-application thresholds, region/entry limits,
  diagnostic bounds and persisted typography preprocessing behavior.
- No unresolved requirement ambiguity or authority conflict remains before task generation.
