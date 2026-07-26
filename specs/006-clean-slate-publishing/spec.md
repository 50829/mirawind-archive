# Feature Specification: Clean-slate Publishing and Reading

**Feature Branch**: `main`

**Created**: 2026-07-26

**Status**: Approved

**Input**: Rebuild the ZIP upload, background processing, publishing workbench, draft
preview, publication, and reading loop as a one-time clean cut.

## Scope

This feature replaces the existing publishing and reading loop in one clean cut. The
superseded loop is removed as part of the same delivery rather than retained alongside the
replacement.

In scope:

- MinerU ZIP upload and meaningful progress
- background import, preview, and publication work
- structure confirmation in a two-pane publishing workbench
- faithful draft preview and atomic publication
- published reading, resources, and search
- the permanent deletion behavior delivered by feature 005

Out of scope:

- homepage, login, library, and book-detail redesign
- EPUB, notes, highlights, bookmarks, reading progress, and full folder management
- new infrastructure services or realtime transport

The replacement must preserve archive safety, isolated background work, private-resource
protection, permanent deletion, immutable published versions, atomic publication, recovery,
search authorization, and accessible formulas.

## User Scenarios & Testing

### User Story 1 - Import with Trustworthy Progress (Priority: P1)

As the administrator, I can upload one MinerU 3.4.4 ZIP, see honest upload and background
progress, cancel or safely retry, and enter the workbench only when its preview is ready.

**Independent Test**: Upload the registered 97-page fixture and follow it from upload through
security checks, document recognition, structure preparation, and ready preview.

**Acceptance Scenarios**:

1. **Given** a valid ZIP, **When** upload bytes advance, **Then** percentage never moves
   backward and 100% waits for server acceptance before appearing complete.
2. **Given** a network interruption, **When** the same file is retried, **Then** the retry
   does not create a duplicate import.
3. **Given** cancellation or a hostile/resource-limit ZIP, **When** processing stops,
   **Then** the last safe stage and a recovery action remain while incomplete files are
   removed.
4. **Given** draft preparation has finished but preview has not, **When** the user follows
   the import, **Then** the workbench remains unavailable.

### User Story 2 - Edit Structure Against the Real Reader (Priority: P1)

As the administrator, I can edit one selected structure item beside the actual reading
preview, retain unsaved work through preview builds or conflicts, and locate diagnostics.

**Independent Test**: Exercise representative small, medium, large, and stress structures;
save an edit, continue editing during rebuild, and navigate a diagnostic to its content.

**Acceptance Scenarios**:

1. **Given** a large hierarchy, **When** it is searched or expanded, **Then** the interface
   remains responsive and only the selected item has an editor.
2. **Given** an unchanged draft, **When** structure changes are saved, **Then** they are
   validated together and a new preview begins.
3. **Given** the accepted preview is building, **When** more local edits are made, **Then**
   they remain marked as not yet reflected while another save and publication are disabled.
4. **Given** another change has made the draft stale, **When** save fails, **Then** local
   edits remain intact and reload is explicit; no automatic merge occurs.
5. **Given** a diagnostic tied to content, **When** it is activated, **Then** the structure
   item, preview page, and exact content location are shown together.

### User Story 3 - Preview and Publish the Same Reader (Priority: P1)

As the administrator, I preview the same accessible reading experience that will be
published and can publish it only while the preview still matches the draft.

**Independent Test**: Compare preview and published output for one revision, then exercise
publication interruption and recovery boundaries.

**Acceptance Scenarios**:

1. **Given** unchanged source and structure, **When** preview and publication are built,
   **Then** page addresses, navigation, body, formulas, appearance, interaction, and
   diagnostics match.
2. **Given** an embedded private preview, **When** it loads or navigates, **Then** it cannot
   expose private body content or gain access beyond the active administrator session.
3. **Given** an expired session, logout, deleted book, or stale preview, **When** preview
   content or resources are requested, **Then** their existence remains hidden.
4. **Given** unsaved changes, stale preview, failed build, or blocking diagnostics,
   **When** publication is requested, **Then** the current published version is unchanged.
5. **Given** a valid ready preview, **When** publication finishes, **Then** new pages,
   resources, search, and metadata become visible together.

### User Story 4 - Read an Accessible Published Book (Priority: P2)

As a reader, I can read a responsive public book with hierarchical navigation, correct
heading structure, and formulas that are visually singular and accessible.

**Independent Test**: Read representative pages on desktop and mobile, with keyboard only,
enlarged text, high zoom, and unavailable optional formula styling.

**Acceptance Scenarios**:

1. **Given** a valid formula, **When** the page is displayed with complete or partial styles,
   **Then** it appears visually once and retains an accessible mathematical representation.
2. **Given** wide tables, code, media, or formulas, **When** the viewport is narrow or
   zoomed, **Then** ordinary text reflows and only intrinsically wide content scrolls.
3. **Given** keyboard navigation, **When** focus moves through the page, **Then** repeated
   navigation can be skipped, focus remains visible, and controls do not overlap content.
4. **Given** the reference single-host workload, **When** uncached reading is measured,
   **Then** server response p95 is no more than 300 ms during background work.

### Edge Cases

- Upload reaches 100% but the server rejects it before accepting the import.
- Progress arrives late or out of order after cancellation.
- The book is deleted or the administrator logs out while a preview is open.
- Local edits continue while the previous preview fails.
- A stress-size structure is opened and then canceled or left.
- Publication is interrupted at each file, search, and visibility boundary.
- Formula styling is unavailable for aligned, tagged, long, or invalid formulas.

## Requirements

### Functional Requirements

- **FR-001**: The product MUST replace the publishing and reading loop in one clean cut,
  removing the superseded paths in the same delivery.
- **FR-002**: Upload MUST show the primary limits before selection and keep secondary safety
  limits available without overwhelming the main flow.
- **FR-003**: Upload MUST show byte-based progress, distinguish transfer from server
  acceptance, support cancellation, and retry network failures without duplication.
- **FR-004**: Each background operation MUST expose only stages that are meaningful for that
  operation, with bounded progress and a persistent safe failure reason.
- **FR-005**: Import status MUST present confirmation, current work, and matching preview as
  one consistent view.
- **FR-006**: The workbench MUST open only when the current draft has a ready preview.
- **FR-007**: Preview MUST faithfully match the published reading experience for the same
  accepted draft, except for privacy and management-only capabilities.
- **FR-008**: Private previews MUST remain isolated, session-protected, non-indexable,
  non-cacheable, and unable to disclose private content through navigation or errors.
- **FR-009**: Every valid formula MUST have one visual representation and one accessible
  mathematical representation, including when optional full styling is unavailable.
- **FR-010**: Published reading MUST provide correct heading hierarchy, skip navigation,
  visible focus, usable control targets, and local overflow for intrinsically wide content.
- **FR-011**: The desktop workbench MUST provide a stable action area, a searchable and
  collapsible hierarchical list, a selected-item editor, and a sticky preview with desktop
  and phone widths.
- **FR-012**: Diagnostics MUST be filterable and able to locate the corresponding structure
  item, preview page, and content.
- **FR-013**: Saving MUST reject stale drafts, preserve local edits after conflict, and start
  a new preview only after complete validation.
- **FR-014**: A second save and publication MUST wait while the accepted preview is being
  rebuilt; later local edits remain marked as not reflected.
- **FR-015**: Publication MUST be unavailable for unsaved, stale, building, failed, or
  blocking-diagnostic states.
- **FR-016**: Mobile workbench MUST default to preview, keep preview/structure as the only
  top-level modes, use full-screen detail dialogs, and restore focus when they close.
- **FR-017**: Successful work MUST be communicated by the changed content and available
  actions rather than success notifications; failures remain visible with a recovery action.
- **FR-018**: Archive defenses, permanent deletion, isolated background work, atomic
  publication, recovery, authorization, and accessible formulas MUST remain effective
  after the replacement.

### Non-Functional Requirements

- **NFR-001**: Every private or public page and resource MUST have verified access,
  sharing, search-engine visibility, and privacy behavior.
- **NFR-002**: Hostile packages, invalid book data, interrupted background work, failed
  publication, unavailable previews, and interrupted deletion MUST fail safely and remain
  recoverable where recovery is supported.
- **NFR-003**: Public uncached reading p95 MUST be at most 300 ms for the registered real
  fixtures and the 500-page synthetic workload.
- **NFR-004**: Large and stress-size structures MUST keep rendered work bounded; the
  stress-size case only requires non-crash and cancellable departure.
- **NFR-005**: The interface MUST pass narrow-screen reflow, representative responsive
  screenshots, enlarged text, high zoom, keyboard, focus restoration, and WCAG 2.2 AA
  automated checks without overlap.
- **NFR-006**: Logs and user-visible status MUST NOT contain credentials, cookies, private
  body content, unsafe raw paths, or private access tokens.

### Key Entities

- **Import**: One uploaded book package and its current preparation state.
- **Background work**: A bounded import, preview, publication, verification, recovery, or
  deletion operation.
- **Draft**: The current authoritative structure choices for a book.
- **Draft change**: A conflict-detectable set of local structure edits.
- **Preview**: A private reading result tied to one exact draft.
- **Reading page**: Shared book, navigation, body, and capability data used by preview and
  publication.
- **Published version**: A complete immutable reading result that can become current only as
  a whole.

## Success Criteria

- **SC-001**: The 97-page fixture completes upload-to-public-reading without manual
  recovery.
- **SC-002**: Registered 441- and 583-page fixtures build, publish, search, and serve readers
  while the old current version remains available during rebuild.
- **SC-003**: Upload percentage never decreases or reports completion before acceptance.
- **SC-004**: Preview and publication have no difference in page addresses, body,
  navigation, formulas, appearance, or interaction for the same draft.
- **SC-005**: Unauthorized, expired, logged-out, deleted, and stale preview requests do not
  reveal whether private content exists.
- **SC-006**: Representative large and stress-size structure tests keep browser work bounded
  and remain safely leaveable.
- **SC-007**: Uncached public reading p95 is no greater than 300 ms on the reference host.

## Assumptions

- Saving may collect later local edits, but the next save waits for the accepted preview.
- Preview requires full reader interaction fidelity, not an image-only approximation.
- Registered real fixtures stay private and their titles and contents do not appear in
  tracked files or test reports.
