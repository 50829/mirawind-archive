# Architecture And Path Requirements Checklist: Naming, Import, and Path Closure

**Purpose**: Review whether naming, dependency, filesystem, failure, and browser requirements are
complete and implementation-ready
**Created**: 2026-08-24
**Feature**: [spec.md](../spec.md)

**Audience/Timing**: Formal author and PR-review gate before task generation and again at convergence

## Requirement Completeness

- [x] CHK001 Are ownership-package boundaries defined for every current top-level source area and business module? [Completeness, Plan §Project Structure]
- [x] CHK002 Are requirements present for local, cross-package, cross-module, type-only, export-from, and dynamic imports? [Completeness, Contract §Canonical Imports]
- [x] CHK003 Are both runtime naming prohibitions and intentionally versioned data exceptions documented? [Completeness, Spec §FR-004–FR-005]
- [x] CHK004 Are requirements defined for removing old exports, wrappers, parsers, and fallback paths rather than only renaming them? [Completeness, Spec §FR-006]
- [x] CHK005 Are canonical internal paths, hostile archive paths, storage roots, extraction identity, destructive cleanup, and atomic writes all covered? [Completeness, Spec §FR-007–FR-011]
- [x] CHK006 Are all explicitly requested browser surfaces and primary product journeys named? [Completeness, Spec §FR-015; Contract §Browser Verification]

## Requirement Clarity

- [x] CHK007 Is “same package” defined independently of directory depth or import spelling? [Clarity, Contract §Package Map]
- [x] CHK008 Is the precedence between shortest imports and visible cross-package boundaries unambiguous? [Clarity, Spec §Assumptions; Contract §Canonical Imports]
- [x] CHK009 Is the allowed business-module API filename derivable from the target domain without subjective naming? [Clarity, Spec §FR-002; Contract §Semantic Names]
- [x] CHK010 Is “historical version suffix” distinguished from required schema, identity, profile, vendor, and offline-reference values? [Clarity, Spec §FR-004–FR-005]
- [x] CHK011 Is a canonical internal relative path defined component by component, including repeated separators and dot components? [Clarity, Contract §Internal Relative Paths]
- [x] CHK012 Is archive entry identity defined with the exact fields that must remain stable between passes? [Clarity, Data Model §Archive Path Identity]
- [x] CHK013 Is the point at which atomic replacement becomes authoritative explicitly defined? [Clarity, Data Model §Atomic Replacement]

## Requirement Consistency

- [x] CHK014 Do local-relative import requirements preserve D-117/D-123 layering, narrow ports, coupling limits and acyclic modules? [Consistency, D-124; Spec §FR-002–FR-003]
- [x] CHK015 Do semantic runtime names remain consistent with constitutional strict schema-version requirements? [Consistency, D-124; Spec §FR-005/FR-013]
- [x] CHK016 Do path-hardening requirements preserve the documented Linux-only, local-storage deployment instead of implying cross-platform support? [Consistency, Spec §Out of Scope; Contract §Residual Threat Boundary]
- [x] CHK017 Do browser requirements preserve existing authentication, authorization, cache and indexing contracts? [Consistency, Spec §NFR-001; Contract §Browser Verification]
- [x] CHK018 Do cleanup requirements preserve immutable publication and worker retry/recovery semantics? [Consistency, Spec §FR-010–FR-013]

## Acceptance Criteria Quality

- [x] CHK019 Can import-style closure be measured as 100% canonical resolved first-party imports with zero boundary bypasses? [Measurability, Spec §SC-001/SC-004]
- [x] CHK020 Can semantic naming closure be measured without falsely counting stored version literals or vendor names? [Measurability, Spec §SC-002]
- [x] CHK021 Are filesystem failure outcomes measurable in terms of rejected input and absence of unexpected files? [Measurability, Spec §SC-003]
- [x] CHK022 Are worker concurrency and performance preservation expressed with existing numeric limits and tolerances? [Measurability, Spec §SC-005–SC-006]
- [x] CHK023 Are browser outcomes measurable for both surfaces, desktop/mobile layout, visible state, console and required network requests? [Measurability, Spec §SC-007]

## Scenario And Edge Coverage

- [x] CHK024 Are primary, invalid-input, interrupted-cleanup, compatibility-rejection, and non-functional scenarios all represented? [Coverage, Spec §User Stories 1–4 and Edge Cases]
- [x] CHK025 Are Unicode normalization, case folding, Windows drive-relative names, control characters, explicit/implicit directories and prefix conflicts covered? [Coverage, Spec §FR-008 and Edge Cases]
- [x] CHK026 Is changed archive content between inspection and extraction explicitly treated as a failure scenario? [Coverage, Spec §FR-009]
- [x] CHK027 Are existing and replaced symlink roots or managed directories both addressed? [Coverage, Spec §FR-010 and Edge Cases]
- [x] CHK028 Is failure before atomic rename distinguished from failure after rename and parent-directory sync? [Coverage, Data Model §Atomic Replacement]
- [x] CHK029 Are expected authentication redirects and optional resource failures distinguishable from browser regressions? [Coverage, Contract §Failure Inspection]

## Dependencies And Assumptions

- [x] CHK030 Is the clean database baseline and no-migration assumption explicit? [Assumption, Spec §Assumptions]
- [x] CHK031 Is continued availability of current private reference fixtures identified for final evidence without making them repository data? [Dependency, Plan §Technical Context]
- [x] CHK032 Is the requirement to preserve port 4321 and choose a separate free local port documented? [Dependency, Spec §Assumptions; Contract §Browser Verification]
- [x] CHK033 Is the single-owner host threat boundary explicit about same-UID or privileged directory races that remain out of scope? [Assumption, Contract §Residual Threat Boundary]

## Notes

- All 33 requirement-quality items passed against the specification, plan, contracts and D-124.
- Depth is a formal release gate; focus is architecture consistency and hostile path/recovery coverage.
- Re-evaluate this checklist if implementation evidence exposes a new path class or versioned artifact.
- Final re-evaluation passed after canonical-parent symlink hardening, current-source reference exact,
  performance, E2E and in-app Browser evidence. Chrome execution remains an external task condition,
  not a requirements-quality defect.
