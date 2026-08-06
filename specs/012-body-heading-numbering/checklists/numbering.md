# Heading Numbering Requirements Checklist

## Role Semantics

- [x] CHK001 Is `body` the only role eligible for generated numbering? [Spec FR-004]
- [x] CHK002 Are frontmatter, appendix and backmatter exclusions stated without relying on title keywords?
      [Spec FR-004, Data Model]
- [x] CHK003 Is behavior defined when正文 starts below heading level 1 or contains no level-1 heading?
      [Spec FR-005, Edge Cases]
- [x] CHK004 Is empty正文 behavior bounded by the same no-zero/no-non-body rules? [Spec Edge Cases]

## Mode Semantics And Reversibility

- [x] CHK005 Are `source`, `generated` and `none` independently and exhaustively defined? [Spec FR-001,
      FR-004, FR-006]
- [x] CHK006 Does the specification prohibit Markdown rewriting and source-number deletion during every
      transition? [Spec FR-007]
- [x] CHK007 Is appendix source-number behavior distinguished from appendix generated-number behavior?
      [D-122, Spec FR-004, FR-006]
- [x] CHK008 Are custom formats, offsets, local exceptions and separate consumer switches explicitly out
      of scope? [Spec Out of Scope]

## Consistency And Input Boundaries

- [x] CHK009 Are all required consumers enumerated and bound to one compiled presentation? [Spec FR-008]
- [x] CHK010 Is a generated/source number required to appear at most once in a label? [Spec FR-008, FR-009]
- [x] CHK011 Are numeric technical titles and rich Markdown prefixes covered as separate cases? [Spec FR-009,
      Edge Cases]
- [x] CHK012 Is conservative handling defined for low-confidence source-number prefixes? [Research Decision 4]

## Management Workflow

- [x] CHK013 Are authoritative GET state, validated PATCH input and ETag concurrency all specified?
      [Spec FR-002, Contract]
- [x] CHK014 Are dirty, accepted-save merge, discard and conflict-retention behaviors covered? [Spec FR-010,
      Data Model]
- [x] CHK015 Does an accepted mode change create one immutable config revision and candidate without mutating
      a published version? [Spec FR-003]
- [x] CHK016 Do invalid values and failed/interrupted builds have testable, non-destructive outcomes?
      [Spec FR-011, NFR-002]

## Non-Functional Boundaries

- [x] CHK017 Are authentication, authorization, cache and indexing policies explicit for affected responses?
      [Spec NFR-001]
- [x] CHK018 Is schema compatibility explicit, including why no version or migration is required? [Spec NFR-004]
- [x] CHK019 Is reader request-path work prohibited and the existing performance target retained? [Spec NFR-003]
- [x] CHK020 Are measurable role, round-trip, hierarchy and workflow outcomes provided? [Spec SC-001-SC-005]
