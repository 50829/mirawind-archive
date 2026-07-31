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
- **FR-008**: Existing import progress, tasks, Passkey actions, workbench behavior, failures,
  and quiet-success behavior MUST remain unchanged.
- **FR-009**: Anonymous `/library` hydration MUST NOT make the protected management-library
  request; administrators MUST still load that projection after an authorization-checked,
  private, non-cacheable capability decision.
- **FR-010**: Public library HTML bytes, validators, cache policy, indexing, and anonymous
  content MUST remain independent of session state.
- **FR-011**: The implementation MUST use the existing Tailwind palette and components and
  MUST NOT introduce a second shell, client router, global store, UI kit, schema, or service.

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

## Out of Scope

- Publishing formats, KaTeX output, database schema, immutable versions, M2/M3 features, EPUB,
  metadata, visibility, folders, batch management, or reading state.
- Homepage, login, library-card, or broad brand redesign; dark mode or new UI infrastructure.
