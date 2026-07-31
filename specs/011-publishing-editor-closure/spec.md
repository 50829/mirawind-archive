# Feature Specification: Publishing Editor Closure

**Feature Branch**: `main`  
**Created**: 2026-07-31  
**Status**: Approved

## User Scenarios & Testing

### User Story 1 - Generate a correct active book (Priority: P1)

An administrator imports MinerU output and receives a draft whose printed contents, helper blocks,
heading hierarchy, numbering, punctuation and page breaks reflect the book rather than MinerU noise.

**Independent Test**: Import the CSAPP fixture and verify Part/Chapter hierarchy, removed printed TOC,
appendix continuity and exact reference-v2 comparison.

### User Story 2 - Read a faithful page (Priority: P1)

A reader sees one consistent heading label, working formulae, lists, code, diagrams, TOC and page outline
at desktop and mobile widths.

**Independent Test**: Render a representative page containing inline heading math, raw-table math,
plain code, a list and Mermaid, then navigate it by mouse and keyboard.

### User Story 3 - Correct a draft (Priority: P1)

An administrator can select a preview block, edit its Markdown, adjust structure boundaries, understand
diagnostics, and rebuild without losing concurrent local work.

**Independent Test**: Edit one block with `If-Match`, observe a new immutable source/config revision and
candidate, and verify conflict and failed-build behavior.

### User Story 4 - Manage and expose a book deliberately (Priority: P2)

An administrator edits display metadata and cover from the library, publishes a candidate, and changes
private/public access separately.

**Independent Test**: Change draft metadata, publish it privately, then make it public and verify public
projection/cache changes only at the appropriate operation.

### Edge Cases

- Ambiguous printed contents or invalid Mermaid remains readable and produces a bounded diagnostic.
- A diagnostic without an executable target has no action button.
- Stale edits retain local text and cannot overwrite a newer revision.
- Unauthorized preview, asset, edit and metadata requests use the existing hidden/private response policy.

## Requirements

- **FR-001**: Only the cleaned active document may enter structure, pagination, search and publication.
- **FR-002**: Printed TOC and duplicate MinerU helper representations must be absent from active Markdown.
- **FR-003**: Part, Chapter, appendix and descendant levels must remain continuous and source ordered.
- **FR-004**: A heading must have one shared rich label and at most one displayed number everywhere.
- **FR-005**: Chinese typography must preserve code, formulae, links, paths, commands and technical tokens.
- **FR-006**: Reader prose, lists, code, formulae, diagrams, TOC, outline and focus must remain usable at
  320 through 1440 CSS px and enlarged text.
- **FR-007**: The workbench must edit the selected non-heading Markdown block through an immutable revision.
- **FR-008**: Content role must be derived from ordered body/appendix/backmatter boundaries.
- **FR-009**: Diagnostic controls must perform the displayed action or be omitted.
- **FR-010**: Display title, authors, description, alias and cover must be editable from a management page.
- **FR-011**: Publishing must preserve access; public access requires a published version.
- **FR-012**: Management library rows must provide aligned status, deletion and a direct management link.
- **FR-013**: The existing identifiable upload/task progress loop must work in the full local stack.
- **NFR-001**: Management and preview responses remain authenticated, no-index and private/no-store.
- **NFR-002**: Published versions remain immutable and publication remains atomic and recoverable.
- **NFR-003**: Public uncached reading p95 remains at most 300 ms during representative build load.
- **NFR-004**: This is a clean switch; old formats and runtime implementations are removed.

## Key Entities

- **Prepared document**: Full evidence view, active document, removed regions and diagnostics.
- **Source revision**: Immutable Markdown plus stable block identities and reusable asset bindings.
- **Publishing config**: Metadata, heading presentation, boundaries, TOC and pagination overrides.
- **Candidate**: Immutable preview/public/search artifact awaiting explicit publication.

## Success Criteria

- **SC-001**: All fifteen reference-v2 books compare exactly and the production closure fixture passes.
- **SC-002**: Reported Reader/TOC/outline/focus defects are absent at required viewports and zoom levels.
- **SC-003**: Block editing, metadata, cover, publish and access workflows complete without internal IDs.
- **SC-004**: Existing security, deletion, recovery and 300 ms reading gates pass.

## Out of Scope

- Folder/batch management, M3 reading state, EPUB ingestion and manual printed-TOC adjudication.
