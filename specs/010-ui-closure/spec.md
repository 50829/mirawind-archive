# Feature Specification: UI Correctness and Shell Closure

**Feature Branch**: `main`
**Created**: 2026-07-31
**Status**: Approved

## Goal

Close the remaining UI audit defects in the reader, book details, and management pages. This
is a presentation cleanup, not a new publishing, catalog, or identity feature.

## User Stories

### 1. Read a clearly structured page (P1)

A reader can distinguish `h1` through `h4`; long headings, formulae, focus, and fragment
navigation still work at narrow widths and enlarged text.

### 2. Use book details on desktop and mobile (P1)

A reader sees the existing cover or a stable placeholder, reaches reading and downloads
quickly, and sees a concise directory preview. On phones the route-driven native dialog uses
the full usable viewport while retaining direct access, close, Back/Forward, scroll, and focus
restoration.

### 3. Navigate one management surface (P2)

Import, tasks, security, and a book workbench share the same product identity, primary
navigation, current-location indicator, and responsive title hierarchy without changing their
existing controls or status behavior.

### 4. Load the public library without a failed probe (P2)

An anonymous library load does not predictably call a protected management API and receive a
`401`. An administrator still receives the private management enhancement, while public HTML,
ETag, and cache behavior remain independent of session state.

### 5. Follow an import from file selection to completion (P1)

An administrator sees the selected ZIP name once, then keeps a continuous view of upload,
server acceptance, queued work, worker progress, failure, and completion. The task list names
the affected book or ZIP and uses plain-language stages, so internal identifiers are never
required to understand or recover work.

## Requirements

- **FR-001**: Shared ReaderShell CSS MUST give `h1` through `h4` a restrained, continuous
  hierarchy distinct from body text, with safe wrapping and visible fragment/focus targets.
- **FR-002**: The two invalid CSS declarations identified in the UI audit MUST be corrected.
- **FR-003**: Book details MUST show the existing published cover or a stable title-based
  placeholder; this MUST NOT add a new cover authority.
- **FR-004**: The detail directory preview MUST preserve order and visible hierarchy, render
  at most 16 entries, state the total when truncated, and link to reading for the full TOC.
- **FR-005**: Reading, close/return, and available original-download actions MUST be reachable
  before or independently of the directory preview.
- **FR-006**: The native detail dialog MUST fill the usable viewport on narrow screens and
  remain bounded on wider screens; existing route/history/focus/cache behavior MUST remain.
- **FR-007**: `/manage`, `/manage/tasks`, `/manage/security`, and the publishing workbench MUST
  use one shared responsive Astro shell with exactly one current primary section.
- **FR-008**: Existing Passkey actions, workbench behavior, failures, and quiet-success behavior
  MUST remain unchanged.
- **FR-009**: Anonymous `/library` hydration MUST NOT make the protected management-library
  request; administrators MUST still load that projection after an authorization-checked,
  private, non-cacheable capability decision.
- **FR-010**: Public library HTML bytes, validators, cache policy, indexing, and anonymous
  content MUST remain independent of session state.
- **FR-011**: The implementation MUST use the existing Tailwind palette and components and
  MUST NOT introduce a second shell, client router, global store, UI kit, schema, or service.
- **FR-012**: File selection MUST present one accessible control and display the selected ZIP
  name exactly once; choosing another file replaces it.
- **FR-013**: The import view MUST remain associated with the accepted upload and continuously
  show upload bytes, server acceptance, queue state, worker phase, and terminal outcome.
- **FR-014**: A known progress total MUST produce a bounded integer percentage and progress bar;
  an unknown total MUST show an explicit indeterminate state instead of `0%` or fake progress.
- **FR-015**: Each task MUST lead with a human-readable operation and affected book or ZIP.
  Internal job kind, phase, and identifier MAY remain as secondary troubleshooting details.
- **FR-016**: The private task/import projection MAY retain the cleaned ZIP display name, but it
  MUST NOT expose it publicly, treat it as book metadata, or log it as task telemetry.

## Acceptance

- Reader headings remain distinct and non-overlapping at 320, 360, 768, 1024, and 1440 CSS px
  and at 200% text sizing.
- At 360 px the detail dialog fills the usable viewport, shows one cover/fallback, keeps close
  and reading available, and renders no more than 16 TOC links.
- The four management routes expose the same three-section navigation and one current item
  without overlapping their controls.
- Anonymous `/library` produces zero `4xx` management requests; an administrator still sees
  the management enhancement.
- Anonymous and administrator requests for the same public library state produce identical
  cacheable HTML and validators.
- Existing focused reader, detail, library, authentication, deletion, and publishing tests
  remain green.
- After an upload is accepted, its ZIP identity and current stage remain visible without a page
  change; all task cards are understandable without reading an internal identifier.
- Determinate progress is an integer from 0 through 100 and never decreases within one phase;
  queued and otherwise indeterminate work is named without a misleading percentage.

## Out of Scope

- Publishing formats, KaTeX output, immutable versions, M2/M3 features, EPUB, metadata,
  visibility, folders, batch management, or reading state. The only storage change is the
  private import ZIP display name required to identify queued work.
- Homepage, login, library-card, or broad brand redesign; dark mode or new UI infrastructure.
