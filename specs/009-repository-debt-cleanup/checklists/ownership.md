# Ownership and Cleanup Boundary Checklist

**Purpose**: Confirm that the cleanup requirements define one write owner, one transaction boundary,
and a deliberately limited removal scope before implementation.

**Created**: 2026-07-31

**Feature**: [spec.md](../spec.md)

## Write Ownership

- [x] Catalog-owned and Publishing-owned table families are named without assigning the same write
      responsibility to both modules.
- [x] Cross-module mutation is limited to explicit cleanup and presentation operations rather than
      concrete adapter imports or copied relationship queries.
- [x] Generic task persistence excludes candidate and deletion lifecycle policy.
- [x] Version presentation persistence has one authoritative writer for registration, recovery and
      reconciliation.

## Atomicity

- [x] Deletion acceptance, terminal failure/interruption, retry and final purge each require one
      transaction spanning the task row and deletion record where both participate.
- [x] Final filesystem removal remains idempotent and occurs before the final database purge.
- [x] A failed transaction cannot expose a terminal task with a pending deletion record, or the
      inverse.

## Cleanup Scope

- [x] Confirmed dead production files, test-only compatibility paths, redundant exports and
      reproducible ignored output are in scope.
- [x] Private fixtures, environment configuration, tracked evidence and user-authored untracked
      research files are explicitly protected.
- [x] The cleanup does not include content-algorithm rewrites, speculative future interfaces,
      historical-baseline compatibility or tests that only prove removed code is absent.
- [x] Current behavior and representative processing performance have proportional reuse-based
      verification requirements.

## Notes

- All items are satisfied by the approved specification and plan. No clarification or scope change
  is required before task generation.
