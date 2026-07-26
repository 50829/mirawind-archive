# Feature Specification: Content Correctness

**Feature Branch**: `007-content-correctness`

**Created**: 2026-07-26

**Status**: Approved

**Input**: Rebuild MinerU import preprocessing around fifteen Codex image-reviewed books so the
main document, printed contents, heading hierarchy, page splits, protected technical text
and administrator recovery diagnostics are correct on the first preparation pass.

## User Scenarios & Testing

### User Story 1 - Recover the book's real structure (Priority: P1)

As the administrator, I receive an initial draft whose navigation follows the original
book's contents even when MinerU emits nearly every Markdown heading at H2.

**Independent Test**: Prepare each of the fifteen designated books and compare every
document choice, printed-contents region, canonical entry, raw heading disposition, body
match and proposed level with its independently image-derived reference v2.

**Acceptance Scenarios**:

1. **Given** labelled or unlabelled contents using dot leaders, ordinary trailing page
   numbers, multiple columns or wrapped rows, **When** the draft is prepared, **Then** the
   complete frontmatter contents regions are identified without consuming body content.
2. **Given** a brief and a full contents, **When** both are recognized, **Then** both regions
   are excluded and exactly one reviewed canonical region supplies structure.
3. **Given** a late index that resembles a contents, **When** candidates are scored, **Then**
   frontmatter position and later monotonic body recurrence prevent the index from winning.
4. **Given** OCR spacing, punctuation, line breaks, numbering differences, duplicate titles
   or missing rows, **When** sparse global alignment runs, **Then** reliable pairs remain
   matched and each unresolved pair has a local diagnostic.
5. **Given** Parts containing Chapters, **When** hierarchy is proposed, **Then** Parts are h1,
   Chapters within Parts are h2 and descendants shift continuously through at most h4;
   Chapters outside Parts and Appendices reset to h1.
6. **Given** a recognized printed-contents region, **When** preview, publication, navigation
   and search are built, **Then** the printed rows are absent while their matched body
   headings remain.

---

### User Story 2 - Receive reasonable page splits (Priority: P1)

As the administrator, I receive page boundaries at major reading units rather than a page
for nearly every MinerU heading.

**Independent Test**: Compare every proposed split in the fifteen references and verify that
level edits never toggle an independently confirmed split.

**Acceptance Scenarios**:

1. **Given** a Part followed immediately by its first Chapter, **When** splits are proposed,
   **Then** the Part starts a page and the adjacent Chapter does not create a title-only page.
2. **Given** later Chapters nested at h2, **When** splits are proposed, **Then** each later
   Chapter starts a page while ordinary sections do not.
3. **Given** an Appendix or standalone major front/back unit, **When** it is proposed, **Then**
   it starts a page and resets the relevant hierarchy context.
4. **Given** an administrator level override, **When** it is saved, **Then** the explicit
   split choice remains unchanged.

---

### User Story 3 - Preserve technical content during preprocessing (Priority: P1)

As the administrator, I can enable Chinese typography without changing code, paths,
formulas, links, commands or technical tokens.

**Independent Test**: Compare all protected reference ranges and adversarial fixtures
byte-for-byte before and after preprocessing, then run a second identical pass.

**Acceptance Scenarios**:

1. **Given** fenced/inline code, formulas, raw HTML and link destinations, **When** typography
   runs, **Then** their bytes remain unchanged.
2. **Given** Unicode paths, filenames, CLI arguments, versions and identifiers, **When**
   typography runs, **Then** every protected token remains unchanged.
3. **Given** already processed Markdown, **When** the same profile runs again, **Then** the
   output is identical.

---

### User Story 4 - Locate and recover from uncertainty (Priority: P2)

As the administrator, I can understand and locate every withheld structure or preprocessing
decision and execute a valid recovery without losing local edits or changing publication.

**Independent Test**: Trigger boundary, match, hierarchy, split, typography and OCR failures;
activate each diagnostic from the workbench and execute its offered recovery.

**Acceptance Scenarios**:

1. **Given** an unresolved contents entry, **When** its diagnostic is activated, **Then** the
   nearest structure block and preview fragment are selected.
2. **Given** an uncertain region or safe source range, **When** its diagnostic is activated,
   **Then** the relevant region/page/range is shown without including full source content in
   the API diagnostic.
3. **Given** risky typography output, **When** verbatim reprocessing is chosen, **Then** a new
   draft is built from retained input and the current published version remains unchanged.
4. **Given** local unsaved edits, **When** diagnostics are inspected or a conflict occurs,
   **Then** workbench revision and conflict safeguards preserve those edits.

### Edge Cases

- A book has no printed contents, multiple contents regions, or image-only contents.
- Contents use 1-3 columns, alternating margins, wrapped rows, spaced/continuous leaders,
  Roman numerals or ordinary right-aligned page numbers.
- Flat sidecar rows contain `list_items` without per-item boxes.
- The same short title recurs, an entry is missing, or a body-only numbered heading exists.
- Running headers, captions and a late index resemble headings or contents.
- Sidecar data is malformed, oversized or canceled while streaming.
- Poppler/Tesseract are absent, time out, exceed budget or return low confidence.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST identify the main Markdown using complete bundle evidence and
  retain administrator confirmation when the candidate is not unique.
- **FR-002**: The system MUST stream the selected flat MinerU sidecar within byte/record/text
  limits and expand `list_items` while preserving their group order when item boxes are absent.
- **FR-003**: The system MUST identify zero or more printed-contents regions using standalone
  labels, spaced/continuous leaders, right-side page labels, repeated title runs, column order,
  indentation, frontmatter position and later body recurrence; it MUST NOT use a fixed page
  window or stop a reliable region at one intervening non-entry block.
- **FR-004**: All accepted printed-contents regions MUST be excluded from active content and
  exactly one region MUST be canonical when printed contents are present.
- **FR-005**: Boundary confidence MUST be independent of per-entry matching confidence, and
  late indexes MUST be rejected by position and recurrence direction.
- **FR-006**: Contents-to-body matching MUST use sparse global sequence alignment with match,
  entry-skip and heading-skip costs plus a best/second-best margin; ambiguity remains local.
- **FR-007**: Hierarchy MUST combine canonical entries, numbering, indentation and body order
  with the Part/Chapter/Appendix semantics stated in User Story 1, produce continuous h1-h4,
  and allow reliable numbered body-only and clear unnumbered front/back units into the TOC.
- **FR-008**: Split proposals MUST be independent of heading levels and follow User Story 2;
  they MUST avoid empty, adjacent title-only and excessive splits.
- **FR-009**: Typography MUST preserve code, formula, HTML, link destination, path, filename,
  command, version and technical-token ranges byte-for-byte and remain deterministic and
  idempotent.
- **FR-010**: Diagnostics MUST carry a stable code, severity, phase, confidence, bounded
  evidence, current proposal, one block/region/page/safe-range location and only valid
  recovery actions.
- **FR-011**: The workbench MUST synchronize diagnostic activation with structure and preview,
  restore dialog focus, execute supported recoveries and preserve dirty/conflict safeguards.
- **FR-012**: OCR fallback MUST run only when native/sidecar evidence is insufficient, inspect
  at most the first 48 PDF pages at 150 DPI, cap each page at 15 seconds and aggregate OCR at
  10 minutes, obey cancellation/30-minute job limits and delete temporary raster files.
- **FR-013**: OCR absence, timeout, low confidence or malformed evidence MUST preserve accepted
  source and emit diagnostics rather than silently install a lower-confidence proposal.
- **FR-014**: Exactly the fifteen administrator-designated MinerU 3.4.4 bundles MUST form the
  blocking local correctness set; each MUST have a strict reference v2 created by Codex after
  opening every candidate printed-contents PDF page with the image-recognition tool.
- **FR-015**: Reference v2 MUST bind archive/PDF/Markdown hashes and page count, model
  `present|absent`, multiple regions and one canonical region, logical entries, semantic kind,
  body matches, raw-root exclusion anchors/hashes, complete raw-heading accounting, expected
  levels/roles/TOC/splits/display titles, protected ranges and expected diagnostics.
- **FR-016**: Reference tooling MUST reject unknown fields, reference v1 and unknown newer
  versions. Review-pack generation MUST NOT import production proposal modules or populate
  expected ground-truth decisions before Codex image recognition.
- **FR-017**: The final implementation MUST delete the v1 parser, generator and reference
  chain; existing local v1 data MUST NOT be migrated into v2.
- **FR-018**: Preparation, preview and private analysis identities MUST become
  `prepare-draft-v4`, `draft-preview-v4` and `printed-contents-analysis-v2`; existing drafts
  require explicit reprocessing while published versions remain immutable.

### Non-Functional Requirements

- **NFR-001**: Original bundles, PDFs, sidecars and references remain administrator data and
  MUST NOT enter public responses or committed artifacts.
- **NFR-002**: Parsing, OCR, matching and preprocessing run only in bounded worker work and
  obey existing archive, cancellation and 30-minute limits.
- **NFR-003**: Reader requests serve immutable prebuilt output and never analyze documents.
- **NFR-004**: Markdown and `book.yaml` v3 remain authoritative; evidence, OCR, alignment,
  diagnostics and analysis v2 are private rebuildable derivations.
- **NFR-005**: Database schema and public compiler, semantic renderer and reader identities
  remain unchanged.
- **NFR-006**: The fifteen-book correctness gate is separate from the three-real-book plus
  500-page synthetic performance suite and the established 300 ms uncached reader p95 gate.

### Key Entities

- **Reference v2**: Strict, per-book, hash-bound Codex image-recognition ground truth.
- **Layout Evidence**: Bounded sidecar/native/OCR rows with page, reading order and provenance.
- **Printed Contents Region**: Excluded source interval with logical entries and canonical flag.
- **Contents Alignment**: Best and second-best ordered entry/body paths with local states.
- **Structure Proposal**: Ordered body headings with independent level, role, TOC and split.
- **Locatable Diagnostic**: Bounded explanation tied to a block, region, page or safe range.

## Success Criteria

- **SC-001**: All fifteen books exactly match reference v2 for main document, printed state,
  all region boundaries, canonical choice and raw-heading accounting.
- **SC-002**: All fifteen exactly match every reviewed body association, hierarchy, role and
  TOC decision; no printed row survives in preview, publication, search or navigation.
- **SC-003**: All fifteen exactly match reviewed splits with zero empty or adjacent title-only
  pages.
- **SC-004**: Protected ranges from all fifteen and adversarial fixtures remain byte-identical
  and a second typography pass changes zero bytes.
- **SC-005**: Every warning/error in the reference set has the reviewed code/location/recovery
  and workbench activation reaches it without losing dirty edits.
- **SC-006**: Missing OCR tools, per-page/aggregate timeout, malformed sidecar and cancellation
  leave no partial accepted source or temporary raster files.
- **SC-007**: Each correctness preparation completes within 30 minutes; the separate build and
  reader performance suite retains its existing thresholds including 300 ms p95.

## Assumptions

- The fifteen bundles and original PDFs are locally available for visual review.
- Codex image recognition builds the blocking fixture without a human adjudication step; it is
  not an interactive step for ordinary imports.
- Insufficient evidence produces a local diagnostic rather than invented hierarchy.

## Out of Scope

- Editing/reordering body paragraphs, general PDF ingestion or server-side MinerU.
- Metadata, visibility, folders, batch management and reading state.
- MinerU versions other than 3.4.4.
- Changing `book.yaml` v3, database schema or public publication identities.
