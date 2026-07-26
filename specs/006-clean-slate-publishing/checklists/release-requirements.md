# Release Requirements Checklist: Clean-slate Publishing and Reading

**Purpose**: Review requirement quality for the clean switch, private preview, workbench
state model and shared reader before release
**Created**: 2026-07-26
**Feature**: [spec.md](../spec.md)

**Note**: This checklist evaluates whether requirements are complete and unambiguous; it is
not an implementation test list.

## Requirement Completeness

- [x] CHK001 Is the clean switch defined across every in-scope stage, with simultaneous removal of superseded paths and no ambiguity about partial coexistence? [Completeness, Spec §Scope, FR-001]
- [x] CHK002 Are upload transfer, server acceptance, background preparation and ready-preview states all separately defined? [Completeness, Spec §User Story 1, FR-003-FR-006]
- [x] CHK003 Are dirty, stale, building, failed, conflict and blocking-diagnostic workbench states all assigned explicit save and publish availability? [Completeness, Spec §User Story 2, FR-013-FR-015]
- [x] CHK004 Are preview isolation requirements stated for pages, resources, navigation, embedding, caching and indexing rather than only the iframe shell? [Completeness, Spec §User Story 3, FR-008]
- [x] CHK005 Are formula requirements complete for valid, invalid, inline, display, aligned, tagged and long formulas with full or unavailable optional styling? [Coverage, Spec §User Story 4, Edge Cases]

## Requirement Clarity

- [x] CHK006 Is “same reader” defined by observable page addresses, navigation, body, formulas, appearance, interaction and diagnostics? [Clarity, Spec §User Story 3, SC-004]
- [x] CHK007 Is “last safe stage” sufficiently bounded to exclude body content, filenames, paths and secrets? [Clarity, Spec §User Story 1, NFR-006]
- [x] CHK008 Is “blocking diagnostic” distinguished from a permitted degraded formula or code diagnostic? [Ambiguity, Spec §FR-015]
- [x] CHK009 Is the 20,000-item stress expectation clearly limited to bounded work, non-crash and cancellable departure rather than normal interaction latency? [Clarity, Spec §NFR-004]
- [x] CHK010 Is silent success distinguished from necessary running progress, persistent failure and changed follow-up actions? [Clarity, Spec §FR-017]

## Requirement Consistency

- [x] CHK011 Does immediate invalidation of stale preview access remain consistent with retaining unsaved local edits during a rebuild? [Consistency, Spec §User Story 2 and §User Story 3]
- [x] CHK012 Do mobile preview-first requirements remain consistent with diagnostic activation needing synchronized structure and preview location? [Consistency, Spec §FR-012, FR-016]
- [x] CHK013 Does disabling publication for dirty state remain consistent when edits are made after an accepted save but before preview readiness? [Consistency, Spec §FR-014-FR-015]
- [x] CHK014 Are privacy requirements consistent between anonymous, expired, logged-out, deleted and stale preview cases? [Consistency, Spec §User Story 3, SC-005]

## Acceptance Criteria Quality

- [x] CHK015 Can upload monotonicity and the 100%-before-acceptance intermediate state be objectively observed? [Measurability, Spec §SC-003]
- [x] CHK016 Can preview/publication parity be compared without depending on internal implementation identities? [Measurability, Spec §SC-004]
- [x] CHK017 Is the uncached reading p95 target tied to the reference host, registered fixtures and background-work condition? [Measurability, Spec §User Story 4, NFR-003]
- [x] CHK018 Are responsive/accessibility outcomes tied to named viewport, zoom, text enlargement, keyboard, focus and overlap criteria? [Acceptance Criteria, Spec §NFR-005]

## Scenario And Edge Coverage

- [x] CHK019 Are network retry, cancellation, hostile input, resource-limit failure and post-100% server rejection all covered as distinct upload scenarios? [Coverage, Spec §User Story 1, Edge Cases]
- [x] CHK020 Are concurrent edit conflict, edits during rebuild, rebuild failure and explicit reload covered without implicit merge or discard? [Coverage, Spec §User Story 2]
- [x] CHK021 Are publication interruptions covered at file, search and final visibility boundaries with the prior version preserved? [Recovery, Spec §Edge Cases, FR-015]
- [x] CHK022 Are logout, deletion and revision changes while a preview is already open addressed? [Edge Case, Spec §Edge Cases, SC-005]

## Dependencies And Assumptions

- [x] CHK023 Is the MinerU 3.4.4 compatibility boundary explicit and separated from the private identity of registered fixtures? [Dependency, Spec §User Story 1, Assumptions]
- [x] CHK024 Are exclusions for realtime transport, new infrastructure, unrelated page redesign and later reading-state features consistent across scope and assumptions? [Consistency, Spec §Scope, Assumptions]

## Notes

- Check items off only after reviewing the wording and traceability of the cited
  requirements.
- Record any ambiguity beside the item and update the higher-authority artifact before
  implementation changes.
