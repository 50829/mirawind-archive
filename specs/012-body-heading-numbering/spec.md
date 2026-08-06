# Feature Specification: Body Heading Numbering

**Feature Branch**: `main`
**Created**: 2026-08-02
**Status**: Approved
**Input**: Add a whole-book control for automatic heading numbering and removing numbering; automatic
numbering applies only to正文, while frontmatter, appendices and backmatter remain unnumbered.

## User Scenarios & Testing

### User Story 1 - Choose the book numbering mode (Priority: P1)

An administrator chooses 原书编号, 自动编号 or 无编号 while editing a book structure and saves the
choice with the other draft changes.

**Why this priority**: The selected policy is the administrator's primary action and must enter the
authoritative publishing workflow before readers can see a consistent result.

**Independent Test**: Open an authenticated draft, switch from source to generated, save, reload the
draft and verify that the saved mode and rebuilt candidate both use generated numbering.

**Acceptance Scenarios**:

1. **Given** a draft in source mode, **When** an administrator selects 自动编号 and saves, **Then** a new
   config revision and candidate build are created and the selection survives reload.
2. **Given** unsaved local structure edits, **When** the administrator changes the numbering mode,
   **Then** all edits remain in the same dirty draft and are saved together.
3. **Given** a stale draft ETag, **When** the administrator saves a numbering change, **Then** the conflict
   is reported without discarding the local selection or overwriting the newer revision.

---

### User Story 2 - Number only正文 (Priority: P1)

A reader sees generated hierarchical numbers only on headings classified as正文. Frontmatter,
appendices and backmatter remain unnumbered.

**Why this priority**: This is the required semantic boundary; numbering non正文 content would produce a
misleading book structure.

**Independent Test**: Build a book containing frontmatter, nested正文, an appendix and backmatter, then
verify exact heading labels in every compiled consumer.

**Acceptance Scenarios**:

1. **Given** generated mode and a book with 前言,正文, 附录 and 后记, **When** the candidate is built,
   **Then** only正文 headings have generated numbers.
2. **Given** the first正文 heading has final level 2, **When** numbering is generated, **Then** it begins at
   `1` and never displays a zero-prefixed label such as `0.1`.
3. **Given** a正文 hierarchy followed by an appendix or backmatter, **When** the candidate is built,
   **Then**正文 counters do not appear on or continue through those later roles.
4. **Given** the same heading in the page body, TOC, outline, breadcrumb, page metadata and search,
   **When** it is displayed, **Then** every consumer uses the same compiled number and title exactly once.

---

### User Story 3 - Switch modes without content loss (Priority: P2)

An administrator can return to source numbering or hide all numbering without changing the Markdown or
losing imported source numbers.

**Why this priority**: Reversibility makes the control safe for real books and prevents presentation
choices from damaging authoritative content.

**Independent Test**: Switch one draft from source to generated to none and back to source, rebuilding
after each save, and compare Markdown and stored source-number fields with the initial revision.

**Acceptance Scenarios**:

1. **Given** headings with source numbers, **When** mode is none, **Then** no consumer displays a number.
2. **Given** generated or none mode, **When** mode returns to source, **Then** the original recognized
   numbers reappear without reimporting or editing Markdown.
3. **Given** a technical title beginning with a number or a rich Markdown number prefix, **When** modes are
   switched, **Then** title content is neither truncated nor combined with a duplicate number.

### Edge Cases

- The first正文 heading may be level 2 through 4 because final configured levels need only be continuous.
- A role may contain no level-1 heading, and正文 may be empty.
- Titles may begin with decimals that are content, such as `8.5英寸软盘`, rather than source numbering.
- A source number may be wrapped in inline Markdown, such as `**4.4.4** Virtual memory`.
- A save may conflict with a newer config revision or its candidate build may fail; the last accepted
  revision remains authoritative and the local UI state remains recoverable.
- Unauthorized draft reads and writes retain the existing hidden/private management response policy.

## Requirements

### Functional Requirements

- **FR-001**: The authenticated structure editor MUST expose one whole-book segmented control with the
  choices 原书编号 (`source`), 自动编号 (`generated`) and 无编号 (`none`).
- **FR-002**: Draft GET responses MUST return the authoritative numbering mode, and draft PATCH requests
  MUST accept and validate that mode under the existing ETag concurrency contract.
- **FR-003**: Saving a changed mode MUST create a new immutable config revision and schedule the existing
  candidate build; it MUST NOT mutate a published version.
- **FR-004**: Generated mode MUST assign hierarchical numbers only to headings whose derived role is
  `body`; `frontmatter`, `appendix` and `backmatter` headings MUST have no generated number.
- **FR-005**: The first numbered正文 heading MUST start with a positive component and generated labels MUST
  NOT contain a zero-valued ancestor component.
- **FR-006**: Source mode MUST preserve configured source-number presentation for every role, and none mode
  MUST suppress heading numbers for every role.
- **FR-007**: Changing modes MUST NOT rewrite authoritative Markdown or remove stored source numbers.
- **FR-008**: Page body, TOC, page outline, breadcrumb, page metadata, manifest and search MUST consume the
  same compiled heading presentation and MUST NOT independently generate or strip numbers.
- **FR-009**: Number-prefix parsing MUST keep technical numeric title content and rich inline Markdown
  intact and MUST prevent a number from appearing twice.
- **FR-010**: The numbering field MUST participate in the structure editor's existing dirty, discard,
  refresh, merge and conflict behavior without losing unrelated edits.
- **FR-011**: Unknown numbering values MUST be rejected as a typed validation error and MUST NOT create a
  revision or candidate.

### Non-Functional Requirements

- **NFR-001**: Draft GET and PATCH remain authenticated, authorization-scoped, private/no-store and
  no-index; reader response policies remain unchanged.
- **NFR-002**: A failed, canceled or interrupted candidate build leaves the prior accepted revision and
  published version usable and exposes failure through the existing job workflow.
- **NFR-003**: The mode adds no parsing, rendering or indexing work to reader requests and preserves the
  existing 300 ms uncached representative reading target.
- **NFR-004**: `book.yaml` remains version 4 because the feature changes behavior within its existing
  numbering enum; no migration or compatibility branch is introduced.

### Key Entities

- **Numbering policy**: The authoritative whole-book `source | generated | none` choice in a config
  revision.
- **Derived heading role**: The source-ordered `frontmatter | body | appendix | backmatter` classification
  calculated from publishing boundaries.
- **Compiled heading presentation**: The one rebuildable number/title representation shared by all reader
  and search consumers.
- **Draft config revision**: An immutable `book.yaml` revision whose accepted ETag selects the current
  numbering policy and candidate input.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A representative four-role fixture displays generated numbers on 100% of正文 headings and
  0% of frontmatter, appendix and backmatter headings across every heading consumer.
- **SC-002**: Source → generated → none → source round trips preserve the Markdown digest and every stored
  source number exactly.
- **SC-003**: All generated labels in fixtures beginning at levels 1 through 4 contain no zero component.
- **SC-004**: Valid mode saves, stale ETag conflicts, invalid modes and failed candidate builds pass
  automated API and editor workflow tests without losing unrelated draft changes.
- **SC-005**: Existing schema, publication immutability, authorization, cache and 300 ms reader gates pass
  unchanged.

## Assumptions

- D-122 resolves “只用编号正文” as excluding appendices from generated numbering.
- The existing three-value `book.yaml` v4 field remains authoritative and defaults to `source` for newly
  prepared drafts.
- Existing role boundaries and the shared compiled heading presentation remain the only role and display
  authorities.

## Out of Scope

- Per-section numbering toggles, custom numbering formats, starting-number overrides or separate TOC/body
  controls.
- Automatic role inference changes, title or Markdown editing, and retroactive mutation of published
  versions.
- Formula, table, figure, footnote or page numbering.
