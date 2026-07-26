# Tasks: Content Correctness

## Phase 1: Decisions and contracts

- [x] T001 Record D-114 and supersede D-112 in `docs/decisions/decision-log.md`
- [x] T002 Synchronize current contents/hierarchy/split behavior in `docs/product/product-spec.md`
- [x] T003 Rewrite 007 spec, plan, research, model, contracts and quickstart for fifteen-book reference v2
- [x] T004 Run Spec Kit analyze and resolve every unmitigated CRITICAL finding before implementation

## Phase 2: Reference v2 foundation

**Independent gate**: strict parser accepts a minimal complete v2 fixture and rejects v1,
unknown versions/fields, inconsistent regions, incomplete heading accounting and hash drift.

- [x] T005 Add failing strict reference-v2 parser tests in `tests/unit/fixtures/mineru-reference-v2.test.ts`
- [x] T006 Implement per-book exact-field v2 parser/validator in `scripts/fixtures/mineru-reference-v2.ts`
- [x] T007 Add failing review-pack independence, archive safety and cleanup tests
- [x] T008 Implement observation-only pack generation in `scripts/fixtures/create-mineru-reference-pack.ts`
- [x] T009 Add failing exact comparator tests for main-document selection, regions, canonical source, headings, matches, levels, roles, TOC, splits, protection and diagnostics
- [x] T010 Implement bounded comparator/reporting in `scripts/fixtures/compare-mineru-references.ts`
- [x] T011 Register all fifteen archive hashes/page counts and add package scripts/docs
- [x] T012 Delete v1 parser, generator, combined references and package scripts after v2 gates pass

## Phase 3: Streaming layout evidence

**Independent gate**: flat/nested sidecars remain bounded and cancelable; `list_items`, group
order, 1-3 column reading order and wrapped rows match synthetic expectations.

- [x] T013 Add failing streaming byte/depth/count/malformed/cancellation tests in `tests/unit/compiler/layout-evidence.test.ts`
- [x] T014 Add failing list-item and missing-item-bbox order tests
- [x] T015 Add failing one/two/three-column and alternating-margin row reconstruction tests
- [x] T016 Implement streaming flat sidecar and list expansion in `src/compiler/document/layout-evidence.ts`
- [x] T017 Implement bounded column order and wrapped-row reconstruction

## Phase 4: Printed contents and global alignment

**Independent gate**: synthetic labelled/unlabelled, spaced leader, right-page, multiple-region,
late-index, duplicate/missing and no-contents books produce exact candidate and local states.

- [ ] T018 Add failing boundary tests for labels, leaders, ordinary page suffixes and repeated title runs
- [ ] T019 Add failing multi-region/canonical/full-versus-brief and no-fixed-window tests
- [ ] T020 Add failing late-index and boundary-confidence-independent-of-match tests
- [ ] T021 Add failing sparse alignment skip/margin/duplicate/missing tests
- [ ] T022 Implement multi-region discovery/scoring in `src/compiler/document/printed-toc.ts`
- [ ] T023 Implement sparse best/second-best sequence alignment with local diagnostics
- [ ] T024 Apply all accepted exclusions and only canonical hierarchy evidence in source-region handling

## Phase 5: Hierarchy and splits

**Independent gate**: all-H2 Part/Chapter/decimal/Appendix and body-only/front-back fixtures
produce continuous h1-h4 and exact independent split decisions.

- [ ] T025 Add failing semantic-kind/context hierarchy tests in `tests/unit/compiler/structure-proposal.test.ts`
- [ ] T026 Add failing body-only numbered and unnumbered front/back inclusion tests
- [ ] T027 Add failing Part/adjacent-first-Chapter/later-Chapter/Appendix split tests
- [ ] T028 Implement semantic hierarchy precedence and duplicate-safe evidence lookup
- [ ] T029 Implement independent major-unit split pass and gap/title-only suppression

## Phase 6: Protected preprocessing

**Independent gate**: every adversarial and reviewed protected range is byte-identical and
processing is idempotent.

- [ ] T030 Expand failing code/path/formula/link/CLI/version/token interval tests
- [ ] T031 Apply every punctuation/spacing edit only inside eligible segments
- [ ] T032 Emit bounded locatable risk summaries and verify verbatim rebuild from retained input

## Phase 7: OCR and private analysis v2

**Independent gate**: OCR runs only after insufficient native evidence and every tool absence,
timeout, cancellation and success path respects budgets and cleans temporary files.

- [ ] T033 Add Poppler and Tesseract `eng`/`chi_sim` to runtime image and document health checks
- [ ] T034 Add failing process/budget/page-limit/cancellation/cleanup tests with fake executables
- [ ] T035 Implement bounded first-48-page 150-DPI OCR fallback in worker-only code
- [ ] T036 Define, validate and persist revision-pinned `printed-contents-analysis-v2`
- [ ] T037 Verify analysis artifact is private, rebuildable and absent from published resources

## Phase 8: Draft identities and recovery UI

**Independent gate**: v3 drafts are stale until explicit reprocess; v4 preparation/preview
share analysis and every diagnostic activates a valid location/recovery without losing edits.

- [ ] T038 Raise `prepare-draft-v4` and `draft-preview-v4` with stale-draft integration tests
- [ ] T039 Carry preparation diagnostics through draft DTO without source/config leakage
- [ ] T040 Implement typed block/region/page/range activation and supported recovery actions
- [ ] T041 Add component tests for navigation, revision pinning, dirty/conflict preservation, dialog focus restoration and verbatim reprocess

## Phase 9: Fifteen-book references

- [ ] T042 Generate observation packs for all fifteen registered archives without production proposals
- [ ] T043 Render and open every candidate printed-contents page for the eight new books with the Codex image-recognition tool; Codex directly transcribes every logical row, column, indentation, continued line and semantic kind into ground truth without human adjudication
- [ ] T044 Re-run the same Codex image recognition for every printed-contents page of the original seven, inspect frontmatter for the no-contents book, and do not copy reference v1 decisions
- [ ] T045 Author and validate fifteen independent ignored reference-v2 files only from the saved image review; use native/OCR text and MinerU evidence solely as navigation aids
- [ ] T046 Compare production output only after expected v2 decisions are saved; review every raw heading disposition, body match, hierarchy, role, TOC and split without auto-updating ground truth
- [ ] T047 Review protected ranges and expected diagnostics for all fifteen books
- [ ] T048 Run exact fifteen-book comparator and resolve every implementation mismatch without rewriting correct ground truth

## Phase 10: Verification and convergence

- [ ] T049 Run focused unit, contract, integration and component gates
- [ ] T050 Run format, lint, typecheck, full tests and production build
- [ ] T051 Run separate three-real plus 500-page build benchmark and 300 ms reader p95 gate
- [ ] T052 Run Spec Kit analyze and converge, append and finish any remaining tasks
- [ ] T053 Rerun converge with no unmitigated CRITICAL findings and synchronize runtime docs
- [ ] T054 Commit remaining logical implementation and convergence units using Conventional Commits

## Dependencies

T004 blocks implementation. T005-T012 establish an independent oracle before production
algorithm changes. T013-T017 feed T018-T029. T030-T037 can proceed after the reference model
is stable. T038-T041 consume final diagnostic/artifact contracts. T042-T048 require all
comparison tooling, complete Codex image review and drive algorithm correction. T049-T054 are
final gates.
