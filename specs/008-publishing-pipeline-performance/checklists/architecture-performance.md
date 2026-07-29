# Architecture and Performance Requirements Checklist

**Purpose**: Validate that 008 requirements are complete, measurable and internally consistent
before task generation and implementation.

**Created**: 2026-07-30

**Audience**: Author and reviewers at the pre-implementation gate

## Requirement Completeness

- [x] CHK001 Are the authoritative inputs, derived artifacts and server-only lifecycle records
      distinguished without creating a second editable content source? [Completeness, Spec FR-003,
      Plan Constitution Check]
- [x] CHK002 Are the four public publishing boundaries and the explicitly non-public internal
      indexes documented? [Completeness, Spec FR-002, Data Model Core Values]
- [x] CHK003 Are responsibilities specified for publishing, reader, catalog, identity, web,
      entrypoints, composition and platform? [Completeness, Spec FR-009, Plan Project Structure]
- [x] CHK004 Are candidate save, build, ready, publish, retry, discard and reclaim requirements all
      represented? [Completeness, Spec FR-001, FR-004-FR-007]
- [x] CHK005 Are authentication, authorization, cache, indexing and recovery policies defined for
      each changed HTTP representation? [Completeness, Spec NFR-001-NFR-002, HTTP Contract]

## Requirement Clarity

- [x] CHK006 Is `CompiledBook` unambiguously the only whole-book model rather than one member of an
      implied IR chain? [Clarity, Spec Key Entities, Publishing Core Contract]
- [x] CHK007 Is `AsyncIterable` identified as a bounded execution protocol rather than a persisted
      business entity? [Clarity, Spec Key Entities, Research Decision 2]
- [x] CHK008 Are page concurrency, delivery order, retained-result and cancellation requirements
      quantified? [Clarity, Spec FR-012, Plan Constraints]
- [x] CHK009 Is “canonical import” defined across runtime, dynamic and type-only imports with an
      explicit exception boundary? [Clarity, Spec FR-010, Architecture Contract]
- [x] CHK010 Is “low coupling” quantified with direct dependency and injected-port limits rather
      than left as a subjective quality? [Clarity, Spec NFR-007]

## Requirement Consistency

- [x] CHK011 Are the decision log, product spec, feature spec and contracts consistent about one
      candidate build and synchronous publication? [Consistency, Spec FR-002-FR-004]
- [x] CHK012 Are module layering rules consistent with the exception that only composition roots
      assemble applications and adapters? [Consistency, Spec FR-009-FR-010]
- [x] CHK013 Are preview/public semantic-equality requirements consistent with their intentionally
      different URL, authorization, cache, indexing and capability policies? [Consistency, Spec FR-008]
- [x] CHK014 Are clean-switch requirements consistent with the prohibition on forwarding exports,
      old job kinds and dual publication paths? [Consistency, Spec FR-015, Plan Phase D]
- [x] CHK015 Are fifteen-book correctness/performance requirements consistent with the retained
      synthetic stress and historical compatibility fixtures? [Consistency, Spec FR-014, Assumptions]

## Acceptance Criteria Quality

- [x] CHK016 Are total wall, slowest-five, accepted-to-preview, publish-to-public, per-book
      regression and RSS thresholds all objectively measurable? [Measurability, Spec SC-002-SC-005]
- [x] CHK017 Is source-region complexity expressed as a scale ratio with explicit input and output
      thresholds? [Measurability, Spec SC-006]
- [x] CHK018 Are baseline/candidate order, minimum pairs, variability expansion and environment
      binding specified? [Measurability, Spec NFR-003, NFR-008]
- [x] CHK019 Are reader request count, cache state, overlap condition and page/search latency targets
      stated? [Measurability, Spec SC-007, NFR-009]
- [x] CHK020 Can preview/public sameness be measured by semantic digest and normalized content for
      every real fixture? [Measurability, Spec SC-010]

## Scenario and Edge Coverage

- [x] CHK021 Are stale completion, newer save, repeated publication and retry race requirements
      defined? [Coverage, Spec User Stories 1-3 and Edge Cases]
- [x] CHK022 Are crash requirements defined before rename, after rename, during registration and
      immediately after commit? [Recovery Coverage, Spec User Story 3]
- [x] CHK023 Are deletion, visibility change and concurrent-session effects on ready candidates
      addressed? [Edge Case Coverage, Spec Edge Cases]
- [x] CHK024 Are missing/private/old manifest and resource lookups covered while background work is
      active? [Exception Coverage, Spec User Story 5 and Edge Cases]
- [x] CHK025 Are noisy benchmark runs, unavailable fixture data and single-book regression rules
      specified? [Non-Functional Coverage, Spec Edge Cases, Assumptions, NFR-004, NFR-008]

## Dependencies and Scope

- [x] CHK026 Are MinerU/reference availability, baseline commit and same-host execution assumptions
      explicit? [Assumption, Spec Assumptions, NFR-003]
- [x] CHK027 Are unchanged UI, metadata, visibility, folders, batch management and reading-state
      features explicitly excluded? [Scope, Spec Out of Scope]
- [x] CHK028 Is the prohibition on new services, databases, queues, deployments and package
      workspaces explicit? [Constraint, Spec NFR-006 and Out of Scope]
- [x] CHK029 Are compiler/renderer/preview identity changes distinguished from unchanged portable
      schema versions? [Dependency, Plan Constitution Check, Decision D-117]
- [x] CHK030 Is completion tied to reference exactness, architecture zero violations, performance
      thresholds, recovery evidence and Spec Kit convergence rather than directory shape alone?
      [Acceptance Quality, Spec SC-001-SC-010, Plan Phase F]
