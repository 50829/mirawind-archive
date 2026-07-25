# Feature Specification: Library and Reading Loop

**Feature Branch**: `[003-library-reading-loop]`

**Created**: 2026-07-25

**Status**: Complete

**Input**: Complete the user-facing path from discovering a book in the library, through
book details and reading, and back to the library; also connect successful publication to
that path without expanding into the complete folder-management milestone.

## User Scenarios & Testing

### User Story 1 - Discover and open a published book (Priority: P1)

As an anonymous visitor, I can browse the public library, understand which books are
available, inspect a book, and start reading without knowing an internal identifier or
management URL.

**Why this priority**: M1 can publish excellent reading artifacts, but a visitor currently
has no usable discovery path into them.

**Independent Test**: Seed at least two public books and one non-public book, visit the
library anonymously, open one public book's details, start reading, and confirm that the
non-public book is neither visible nor distinguishable from a missing book.

**Acceptance Scenarios**:

1. **Given** one or more current public books, **When** an anonymous visitor opens
   `/library`, **Then** the page presents those books as clear title-led cards and does not
   expose drafts, private books, ready versions, old versions, or unavailable internal
   state.
2. **Given** a public book card, **When** the visitor activates its cover area, **Then** the
   visitor reaches the book's first readable page through its canonical reading route.
3. **Given** a public book card, **When** the visitor activates its title or details action,
   **Then** a route-driven book-details dialog opens over the library and the browser
   address becomes the canonical `/books/:bookKey` address.
4. **Given** a public book with no configured cover, author, subtitle, or description,
   **When** it is presented in the library or details dialog, **Then** a stable,
   title-derived placeholder is shown and absent optional metadata leaves no empty labels
   or broken layout.
5. **Given** no public books, **When** an anonymous visitor opens the library, **Then** a
   useful empty state explains that no public books are available without revealing whether
   private books exist.

---

### User Story 2 - Inspect details without losing library context (Priority: P2)

As a visitor, I can inspect a book's identity, description, table of contents and available
original downloads, then either start reading or return to the same place in the library.

**Why this priority**: A route-driven detail surface is the bridge between discovery and
reading and must work both from a library click and a shared direct URL.

**Independent Test**: Open a details dialog from a scrolled library, close it and verify the
scroll position is restored; then visit the same details URL directly and confirm the
library backdrop and dialog are both usable.

**Acceptance Scenarios**:

1. **Given** a details dialog opened from the library, **When** the visitor closes it with
   its close control, Escape key, or browser Back action, **Then** the prior library URL,
   view and scroll position are restored.
2. **Given** a direct request to a valid public `/books/:bookKey` URL, **When** the page
   loads, **Then** it presents the library as context with the requested details dialog
   already open and provides an unambiguous close destination.
3. **Given** a public book with metadata, a table of contents and registered original
   files, **When** its details open, **Then** the visitor can see the available metadata,
   preview the reading structure, start at the first page, and invoke each permitted
   download through the existing protected download route.
4. **Given** a numeric book address for a book with an alias, **When** the visitor opens it,
   **Then** the route redirects without storage to the current canonical alias address.
5. **Given** a missing, draft, private, reclaimed, non-current, or otherwise unauthorized
   book, **When** an anonymous visitor requests its details, **Then** the response is an
   indistinguishable non-cacheable `404`; if the request resolves to a current public book
   whose current representation is unavailable and cannot be recovered, only that book
   returns the approved non-cacheable `503`.

---

### User Story 3 - Read and navigate on desktop or mobile (Priority: P3)

As a reader, I can move through a book, search within it, use its table of contents and page
outline, and return to the library from either a desktop or mobile viewport.

**Why this priority**: The current reading artifact is functional, but its surrounding
navigation does not yet form a resilient end-to-end interaction.

**Independent Test**: Read a multi-page public book at desktop and mobile widths, navigate
with the table of contents, search result, previous/next controls and permitted keyboard
shortcuts, then return to the library.

**Acceptance Scenarios**:

1. **Given** a reading page, **When** the reader uses the fixed top bar, **Then** the reader
   can return to the library, identify the current book, open book search and access the
   book's registered original downloads.
2. **Given** a multi-page book, **When** the reader selects a table-of-contents entry,
   previous/next control, or left/right keyboard shortcut outside an editable or interactive
   region, **Then** navigation reaches the expected canonical page and normal page changes
   begin at the top.
3. **Given** a search result, internal heading link or page-outline entry, **When** the
   reader activates it, **Then** the target page and block or heading are brought into view
   without losing the canonical page identity.
4. **Given** a narrow viewport, **When** the reader opens the table of contents, page
   outline, search or downloads, **Then** each appears through an explicit accessible
   control, does not obscure the document permanently, and can be dismissed without
   changing pages.
5. **Given** a missing page, newly private book, or unavailable current version, **When**
   the reader follows an old or unauthorized link, **Then** the system presents the
   approved non-cacheable `404` or book-specific `503` state without leaking another
   version.

---

### User Story 4 - Continue from publication into the reader (Priority: P4)

As the administrator, I can tell when publication has succeeded and immediately inspect the
new current book in the same library and reader surfaces that visitors use.

**Why this priority**: Publication currently ends as an internal job state instead of a
clear user outcome.

**Independent Test**: Publish a prepared draft, wait for the background job to complete,
open the resulting book from the success state, and verify the library, details and reader
all show the same newly published version.

**Acceptance Scenarios**:

1. **Given** a publication job succeeds, **When** the administrator views the preview or
   task result, **Then** a clear success state offers actions to view the published book and
   return to the library.
2. **Given** publication is queued or running, **When** the administrator waits on the
   result, **Then** progress uses reader-facing phase labels and never claims that the book
   is live before the current-version switch commits.
3. **Given** publication fails, becomes stale, is canceled, or is interrupted, **When** the
   administrator views the result, **Then** the previous published version remains
   reachable and the interface presents a safe actionable next step.
4. **Given** an authenticated administrator opens the library, **When** private library
   state loads, **Then** drafts and private books appear with lightweight status labels
   without placing that state in public cacheable HTML.
5. **Given** the administrator activates a draft or private book, **When** no readable
   current version is available, **Then** the interface leads to the relevant preview or
   management action rather than a broken reader URL.

### Edge Cases

- A public book is made private while its library card, details dialog, search result or
  reading page is already open.
- A draft title or metadata changes while an older public version remains current.
- A current version is rolled back or marked corrupt between listing the library and opening
  details or reading.
- A book alias changes or an old alias is reused.
- A book has a very long title, one hundred authors, a long description, thousands of table
  of contents entries, no cover, no downloads, or only one reading page.
- A search request is empty, contains FTS syntax characters, or uses a one- or two-character
  query with the existing reduced search scope.
- JavaScript fails or hydration is delayed: public books, direct detail URLs and reading
  links remain navigable through server-delivered semantics.
- Focus is inside search, dialog, drawer, code, form or editable content when Escape or arrow
  keys are pressed.
- Multiple tabs publish or change visibility while another tab holds a stale library or
  details representation.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST provide `/library` as the public root library and list only
  books whose current immutable version is published and whose current visibility is
  public.
- **FR-002**: Public library cards MUST provide a title, optional author text, an available
  versioned cover or stable title placeholder, a direct reading action and a distinct
  details action.
- **FR-003**: Public library metadata and canonical alias MUST describe the current
  published version; draft configuration changes MUST NOT appear until a version using them
  is successfully published.
- **FR-004**: The library MUST provide useful public empty, unavailable and error states
  without disclosing non-public book counts, identities or lifecycle states.
- **FR-005**: The system MUST provide `/books/:bookKey` as a route-driven details dialog over
  the library context, usable both through client navigation and a direct server request.
- **FR-006**: Closing a details dialog opened from the library MUST restore the previous
  library location and scroll position; closing a directly requested dialog MUST return to
  `/library`.
- **FR-007**: Book details MUST show all available configured title, subtitle, author,
  description and language metadata, a table-of-contents preview, a start-reading action,
  and links for every currently permitted registered original file.
- **FR-008**: Optional or missing metadata, cover, contents and downloads MUST be omitted or
  replaced by an explicit stable fallback without empty controls or broken resources.
- **FR-009**: Numeric book routes MUST redirect to a current alias when one exists; obsolete
  aliases MUST remain invalid and redirects and missing routes MUST be non-cacheable.
- **FR-010**: The reader MUST provide a fixed top bar, full-book table of contents, semantic
  document, current-page outline, search, registered downloads and previous/next
  navigation.
- **FR-011**: Narrow viewports MUST expose table of contents, outline, search and downloads
  through keyboard- and assistive-technology-operable controls that trap neither focus nor
  document scrolling after dismissal.
- **FR-012**: Reader arrow-key navigation MUST be disabled while focus is in an editable,
  form, code or other interactive region and MUST NOT replace native mobile scrolling with
  swipe pagination.
- **FR-013**: Search, table-of-contents, page-outline and internal links MUST preserve valid
  page and block targets and use the current version only.
- **FR-014**: The home page MUST provide a clear semantic link to `/library` without adding
  the deferred featured-shelf experience.
- **FR-015**: After successful publication, the administrator MUST receive links to the
  canonical published details or reading route and to `/library`; these links MUST appear
  only after the current-version transaction commits.
- **FR-016**: Publication progress and terminal states MUST use comprehensible labels and
  offer a safe retry, preview, task inspection or previous-version action appropriate to
  the actual state.
- **FR-017**: An authenticated administrator MUST be able to augment the public library with
  draft and private book entries and lightweight lifecycle labels through a non-cacheable
  private response; public cacheable HTML MUST remain identical for administrators and
  anonymous visitors.
- **FR-018**: A draft or private entry without a readable current version MUST lead to its
  available preview or management surface rather than a public reader route.
- **FR-019**: Anonymous access to draft, private, missing, ready, reclaimed, orphaned or
  unauthorized details and resources MUST follow the existing indistinguishable `404`
  policy. A request that resolves to a current public book whose current presentation,
  manifest or required file is unavailable and cannot be recovered MUST return only the
  existing isolated non-cacheable book-specific `503`.
- **FR-020**: Every library, details, reader and supporting API response class MUST declare
  authentication, authorization, cache and search-indexing behavior consistent with the
  current visibility and version.
- **FR-021**: The library, details dialog and reader navigation MUST remain semantically
  usable when client-side enhancement is unavailable; enhancement MAY improve transitions,
  drawers and scroll restoration but MUST NOT be the only way to reach content.
- **FR-022**: The implementation MUST preserve the single current-version read, immutable
  asset URLs, original-download authorization and search filtering boundaries established
  by M1. Versioned resources from a superseded version that was successfully published MAY
  remain readable while the book is still public and the version is not reclaimed, as
  required by D-077; ready, corrupt, reclaimed and orphaned version resources remain hidden.

### Non-Functional Requirements

- **NFR-001**: Public library and public details HTML MUST contain no administrator identity,
  private book state, draft metadata, session-derived controls or private reading data.
- **NFR-002**: Public library and details responses MUST use immediate revalidation with
  strong representation identities; private enhancements and all hidden/error responses
  MUST prohibit storage under the existing response policy.
- **NFR-003**: On the reference single-host deployment with 1,000 current books, an uncached
  public library response and direct public details response MUST each meet a 300 ms p95
  server-response target while a background rebuild is running.
- **NFR-004**: At viewport widths from 360 through 1,440 CSS pixels, the primary discovery,
  details and reading actions MUST remain visible or reachable without horizontal page
  scrolling; wide document tables and images MAY scroll within their own bounded region.
- **NFR-005**: All interactive controls introduced by this feature MUST have programmatic
  names, visible focus indication, logical keyboard order and reduced-motion behavior; the
  primary journeys MUST pass automated accessibility checks with no serious or critical
  finding.
- **NFR-006**: Schema changes, if required to provide version-consistent derived library
  metadata, MUST have an approved version decision, forward migration, compatibility
  fixtures and rollback-safe migration tests before runtime use.
- **NFR-007**: Library and details reads MUST use bounded data and caches: descriptions,
  author lists, contents previews and in-process entries MUST enforce explicit limits rather
  than loading complete book bodies.
- **NFR-008**: The feature MUST add automated public, administrator, mobile, no-client-script,
  visibility-transition, current-version and publication-completion evidence before it is
  considered complete.

### Key Entities

- **Library Entry**: A bounded presentation of one current public book or one
  administrator-visible draft/private book, including canonical identity, display metadata,
  cover presentation, lifecycle label and destination actions.
- **Published Book Details**: Version-consistent display metadata, table-of-contents preview,
  first readable page and registered original downloads for the current immutable version.
- **Library Context**: The current root-library URL, scroll position and dialog-navigation
  state restored when details close.
- **Publication Outcome**: The administrator-visible result of a publish job, including its
  actual terminal state and canonical destinations only after a successful current-version
  cutover.

## Success Criteria

### Measurable Outcomes

- **SC-001**: From `/library`, a first-time visitor can reach the first page of any public
  book in at most two deliberate actions and can return to the library in one action.
- **SC-002**: All supported close methods restore the prior library context in automated
  desktop and mobile journeys, including a library scrolled beyond the first viewport.
- **SC-003**: Anonymous route and content matrices expose zero draft, private, ready, old or
  reclaimed book entries, metadata fields, contents entries, downloads or resource URLs.
- **SC-004**: After publication succeeds, the library, details dialog, reader and search
  resolve the same current version in every tested crash-boundary and stale-build scenario.
- **SC-005**: The primary public discovery-to-reading journey and administrator
  publish-to-reading journey both complete successfully at desktop and 360-pixel mobile
  widths with no serious or critical automated accessibility finding.
- **SC-006**: With 1,000 current books during one background rebuild, public library and
  details responses remain at or below 300 ms p95 on the documented reference environment.
- **SC-007**: Disabling client-side enhancement still permits a visitor to browse public
  books, open direct details, start reading, navigate pages and return to the library.
- **SC-008**: Every new response class has passing tests for authentication, authorization,
  cache headers, indexing headers, canonical routing and visibility changes.

## Assumptions

- Existing M1 authentication, immutable publication, search, download and worker behavior
  remain authoritative and are reused rather than redesigned.
- This feature presents the root library only. Complete nested folders, drag-and-drop,
  multi-select and per-folder sorting remain a later M2 slice.
- Book metadata is optional according to the product specification; no absent optional
  field is synthesized as factual metadata.
- A stable CSS title placeholder is sufficient when no cover exists. Generated artistic
  cover templates remain deferred to M5.
- Public HTML remains the same for all visitors. Administrator-only library entries and
  controls are loaded from an authenticated private response.
- Existing public books may require a bounded background derivation step after upgrade if
  new version-consistent library metadata storage is introduced; they remain readable
  during that step.

## Out of Scope

- Nested folder creation, rename, move, drag-and-drop, multi-select and bulk operations
- Recycle bin, permanent deletion and storage-management UI
- Editing metadata, aliases, visibility or original attachments from the library
- Reading progress, bookmarks, reading settings, highlights, annotations and notes
- EPUB import and additional attachment ingestion
- Featured shelves, automatic shelves, the full Twilight home page and generated cover art
- Chapter-body reordering, page-alias editing and two-character full-body Chinese search
