# Delivery Requirements Checklist: Library and Reading Loop

**Purpose**: Validate that discovery, details, reader, publication, security, migration and
accessibility requirements are complete enough for implementation and release review
**Created**: 2026-07-25
**Feature**: [spec.md](../spec.md)

**Audience and depth**: Formal implementation/release gate for author and reviewers.

## Requirement Completeness

- [x] CHK001 Are requirements defined for both anonymous discovery and administrator-only
      library augmentation? [Completeness, Spec §US1, §US4, FR-001, FR-017]
- [x] CHK002 Are library card, empty-state, partial-unavailable and missing-metadata
      requirements all documented? [Completeness, Spec §US1, FR-002–FR-004, FR-008]
- [x] CHK003 Are direct details requests, in-library details navigation, every close method
      and canonical redirects specified? [Completeness, Spec §US2, FR-005–FR-009]
- [x] CHK004 Are desktop, narrow-screen and no-client-enhancement reader requirements all
      present? [Completeness, Spec §US3, FR-010–FR-013, FR-021]
- [x] CHK005 Are publication queued, running, succeeded, failed, stale, canceled and
      interrupted outcomes covered? [Completeness, Spec §US4, FR-015–FR-016]

## Requirement Clarity

- [x] CHK006 Is “current published metadata” tied unambiguously to the immutable version
      reached through `current_version_id` rather than a mutable draft cache? [Clarity,
      Spec §FR-003; Data Model §Relationships]
- [x] CHK007 Are “identical public bytes” and the separation of private management data
      stated precisely enough to prohibit Cookie-derived public variants? [Clarity,
      Spec §FR-017, NFR-001–NFR-002; Contract §Response matrix]
- [x] CHK008 Are the bounds for author lists, descriptions, TOC previews, originals,
      pagination and projection payloads explicit? [Clarity, Spec §NFR-007; Data Model
      §Projection validation; HTTP Contract §Limits]
- [x] CHK009 Is the distinction between hidden `404`, current-public isolated `503` and
      allowed superseded published resources explicit? [Clarity, Spec §FR-019, FR-022]
- [x] CHK010 Are mobile drawer and keyboard exclusions defined by concrete controlled
      regions and focusable/interactive categories? [Clarity, Spec §FR-011–FR-012;
      Interaction Contract §Reader, §Keyboard]

## Requirement Consistency

- [x] CHK011 Do alias requirements align across atomic publication, canonical redirects,
      old-alias invalidation and immediate reuse? [Consistency, Spec §FR-003, FR-009; Research
      R-002]
- [x] CHK012 Do public details, reader, search and download requirements resolve the same
      version and source without conflicting visibility rules? [Consistency, Spec §FR-007,
      FR-013, FR-019, FR-022]
- [x] CHK013 Do progressive-enhancement requirements preserve the complete SSR and
      no-JavaScript journeys rather than making the dialog or reader client-only? [Consistency,
      Spec §FR-005, FR-021; Research R-004]
- [x] CHK014 Are the new projection and reconciliation requirements consistent with
      immutable version directories and SQLite remaining the only current pointer?
      [Consistency, Spec §NFR-006; Plan §Constitution Check]
- [x] CHK015 Are deferred nested folders, metadata editing, reading state and homepage
      decoration consistently excluded from every user story? [Consistency, Spec §Assumptions,
      §Out of Scope]

## Acceptance Criteria Quality

- [x] CHK016 Can the two-action discovery target and one-action return target be measured
      without depending on a particular UI framework? [Measurability, Spec §SC-001]
- [x] CHK017 Does scroll/focus restoration have explicit desktop and mobile contexts and
      supported close methods? [Measurability, Spec §SC-002]
- [x] CHK018 Is the zero-private-exposure outcome stated across entries, metadata, TOC,
      downloads and resource URLs? [Measurability, Spec §SC-003]
- [x] CHK019 Are the 1,000-book workload, concurrent rebuild condition, response classes and
      300 ms p95 threshold all named? [Measurability, Spec §NFR-003, SC-006]
- [x] CHK020 Is the accessibility outcome tied to explicit viewport journeys, severity
      levels and behavioral assertions? [Measurability, Spec §NFR-005, SC-005]

## Scenario and Recovery Coverage

- [x] CHK021 Are visibility changes while cards, details, search results and pages are open
      addressed? [Coverage, Spec §Edge Cases]
- [x] CHK022 Are stale draft metadata, alias reuse, current-version rollback and corrupt
      current representation scenarios addressed? [Coverage, Spec §Edge Cases, FR-003,
      FR-019]
- [x] CHK023 Are missing projection, mismatched digest, damaged version and one-book
      reconciliation failure behaviors documented without blocking other books? [Recovery,
      Data Model §Existing-version reconciliation]
- [x] CHK024 Are projection/FTS/ready rollback and final alias/current-pointer rollback
      boundaries explicitly defined? [Recovery, Data Model §State transitions]
- [x] CHK025 Are no-JavaScript, delayed enhancement, multiple tabs and interactive keyboard
      focus alternate scenarios covered? [Coverage, Spec §Edge Cases, FR-012, FR-021]

## Security, Cache and Indexing

- [x] CHK026 Does every introduced HTML, JSON, redirect, error and unavailable response
      class declare authorization, cache and indexing behavior? [Security, Spec §FR-020; HTTP
      Contract §Response matrix]
- [x] CHK027 Is conditional-request ordering defined so old ETags cannot produce a `304`
      after private transition? [Security, HTTP Contract §Response matrix]
- [x] CHK028 Are administrator payload exclusions explicit for credentials, paths, body
      content, raw errors and unredacted progress? [Privacy, HTTP Contract
      §GET /api/manage/library]
- [x] CHK029 Are cover and original-download links constrained to existing versioned
      authorization routes rather than public filesystem paths? [Security, Spec §FR-007,
      FR-022; Data Model §Response view models]

## Dependencies and Assumptions

- [x] CHK030 Is the explicit dependency on M1 authentication, publication, search, download
      and worker behavior documented and protected from redesign? [Dependency, Spec
      §Assumptions]
- [x] CHK031 Is the lifecycle of immutable renderer v1 pages versus newly published
      renderer v2 pages documented without implying automatic publication? [Assumption,
      Research R-005]
- [x] CHK032 Is the direct accessibility-scan dependency justified separately from runtime
      dependencies and paired with manual behavior requirements? [Dependency, Research R-008]

## Notes

- All items passed against Constitution v1.0.0, D-099, D-100, the feature specification and
  Phase 1 design artifacts.
- The earlier old-version/corrupt-status conflict was corrected before this checklist was
  generated.
- Any implementation-driven requirement change must first update the decision log or spec,
  then rerun this checklist and Spec Kit analysis.
