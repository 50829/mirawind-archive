# Feature Specification: MinerU Public Publishing

**Feature Branch**: `[001-mineru-public-publishing]`

**Created**: 2026-07-24

**Status**: Ready for planning

**Input**: Build the first vertical slice that securely imports one MinerU ZIP for one book,
lets the sole administrator confirm its publishing structure, builds a complete immutable
version in the background, atomically publishes semantic Web pages, supports public reading
and Chinese search, and offers the uploaded ZIP as a controlled original download.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Import and prepare one book (Priority: P1)

As the sole administrator, I upload one MinerU ZIP and receive a safe, comprehensible preview
of the detected book, its main Markdown, resources, structure, and diagnostics before
anything becomes public.

**Why this priority**: No later publishing or reading value exists until one real MinerU
package can be accepted safely and converted into an editable publishing proposal.

**Independent Test**: Starting with an empty installation and a valid representative MinerU
ZIP, the administrator can authenticate, upload it, see the detected main document and
diagnostics, and reach a draft structure preview without exposing the draft anonymously.

**Acceptance Scenarios**:

1. **Given** a valid ZIP containing one high-confidence MinerU book, **When** the
   administrator uploads it, **Then** the system selects the main Markdown and prepares a
   draft preview without requiring filename or directory changes.
2. **Given** a ZIP with one generic Markdown file, **When** import analysis finishes,
   **Then** the administrator is asked to confirm that file before preview generation.
3. **Given** an ambiguous or multi-book ZIP, **When** analysis finishes, **Then** import
   stops with candidate evidence and requests a split package rather than guessing.
4. **Given** an archive that violates a security or resource limit, **When** it is processed,
   **Then** the entire import fails, temporary output is removed, and no draft version is
   made readable.
5. **Given** an anonymous visitor, **When** they request any draft preview, source, resource,
   task, or diagnostic URL, **Then** they receive the same non-cacheable not-found behavior
   as for a nonexistent resource.

---

### User Story 2 - Confirm structure and publish atomically (Priority: P1)

As the administrator, I confirm which headings appear in navigation, correct displayed
titles and levels, assign content roles, select heading page boundaries, and publish only
after a complete new version has been built and validated.

**Why this priority**: The product's central value is a trustworthy semantic Web book, and
automated MinerU structure requires human correction without mutating the source Markdown.

**Independent Test**: From a prepared draft, the administrator can change all M1 publishing
overrides, publish it, and observe either the complete new version or the unchanged previous
version across every forced failure boundary.

**Acceptance Scenarios**:

1. **Given** a draft preview, **When** the administrator changes navigation inclusion,
   display title, display level, content role, or a heading page boundary, **Then** the
   source Markdown remains unchanged and the portable publishing configuration records the
   overrides.
2. **Given** an invalid level hierarchy or invalid page split, **When** the administrator
   attempts to save or publish, **Then** the action is rejected with the offending headings
   identified.
3. **Given** no previous publication, **When** every artifact and search record validates,
   **Then** the book becomes public as one complete version.
4. **Given** a currently published version, **When** a replacement build is running,
   **Then** readers continue receiving the complete existing version.
5. **Given** any build, index, validation, timeout, interruption, or commit failure,
   **When** publication cannot complete, **Then** the existing publication remains current
   and the failed version never becomes public.
6. **Given** two stale or conflicting publishing attempts, **When** the older attempt reaches
   cutover, **Then** it cannot overwrite the newer source or configuration revision.

---

### User Story 3 - Read, search, and download the public book (Priority: P2)

As an anonymous reader, I open semantic chapter pages quickly, navigate a coherent book
structure, search Chinese and mixed-language content, and optionally download the exact
registered original ZIP.

**Why this priority**: Public reading is the user-visible outcome of the vertical slice, but
it depends on successful import and publication.

**Independent Test**: A newly published representative book is usable from a fresh anonymous
browser for navigation, semantic reading, supported searches, and resumable original ZIP
download, with no access to internal or private artifacts.

**Acceptance Scenarios**:

1. **Given** a public book, **When** a reader opens any published page, **Then** headings,
   paragraphs, lists, tables, figures, formulas, code, footnotes, and supported semantic
   containers appear as accessible semantic document content rather than screenshots or an
   embedded file viewer.
2. **Given** a new version published in the background, **When** a reader requests a page,
   **Then** the page and all referenced assets belong to one consistent version.
3. **Given** a search of at least three Unicode characters, **When** the reader submits it,
   **Then** current public metadata, headings, and body blocks are searched as a literal
   continuous phrase and results link to the matching block.
4. **Given** a one- or two-character search, **When** the reader submits it, **Then** only
   titles, authors, and chapter headings are searched and the limited scope is explained.
5. **Given** a public book, **When** a reader downloads its original ZIP or resumes a partial
   download, **Then** the current permission is checked and the correct bytes, safe filename,
   type, size, and range are returned without exposing storage paths.
6. **Given** the book changes to private, **When** a new anonymous page, asset, search, or
   download request is made, **Then** it stops being publicly available immediately.

---

### User Story 4 - Operate and recover background work (Priority: P3)

As the administrator, I can see durable task status and failure categories, retry eligible
work, and recover service after a process or host restart without accidentally publishing an
unfinished book.

**Why this priority**: Large imports are expected to outlive individual requests and must be
operable on a self-hosted server, but this story does not change the book's core reader value.

**Independent Test**: Interrupt the worker during each major build phase, restart the
application, and verify durable status, bounded retry, cleanup, and unchanged publication.

**Acceptance Scenarios**:

1. **Given** queued or running work, **When** the administrator views task status, **Then**
   phase, attempt, timing, and a safe error category are visible without exposing private
   content or unsafe raw paths.
2. **Given** a process or host interruption, **When** service resumes, **Then** the task is
   marked interrupted, incomplete staging is cleaned, and at most one infrastructure-only
   automatic retry may start from the preserved ZIP.
3. **Given** a content, validation, security-limit, timeout, or second-interruption failure,
   **When** recovery runs, **Then** the task waits for explicit administrator retry.
4. **Given** a complete ready version that was not published before interruption, **When**
   service restarts, **Then** it remains unpublished until the administrator retries the
   publish action.
5. **Given** a missing or corrupt current version, **When** startup reconciliation runs,
   **Then** the book falls back to the newest verified predecessor or only that book reports
   temporary unavailability when no predecessor exists.

### Edge Cases

- ZIP uses nested wrapper directories, Windows separators, Unicode-equivalent names, duplicate
  normalized paths, absolute paths, traversal, links, special files, encryption, unsupported
  compression, or malformed metadata.
- Archive claims safe metadata but exceeds actual byte, entry, pixel, path, time, or expansion
  limits while streaming.
- Main Markdown is absent, empty, too large, ambiguous, nested deeply, or references missing
  or outside-root resources.
- Raw HTML contains scripts, event handlers, unsafe URLs, or local resource references.
- Formula rendering fails while the surrounding document remains valid.
- Headings skip semantic levels, duplicate aliases, or attempt a page split inside a block.
- The worker stops before/after file finalization, search preparation, or publication cutover.
- A reader holds old HTML while a new version publishes or the book becomes private.
- Search input contains quotes, operators, wildcards, punctuation, combining characters,
  formulas, one/two CJK characters, or mixed Chinese and Latin text.
- A Range request is malformed, unsatisfiable, or races with a visibility change.
- Recovery finds incomplete staging, an unreferenced complete directory, a database version
  without files, or a corrupt current manifest.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST have exactly one administrator, no public registration, and
  real authenticated sessions for every management page and action.
- **FR-002**: The administrator MUST be initialized and fully recoverable only through an
  offline server command; Web recovery MUST NOT exist.
- **FR-003**: The administrator MUST be able to register and manage up to ten named Passkeys
  while retaining a 16-to-128-character fallback password. Adding, renaming, or deleting a
  Passkey MUST require server-verified authentication within the previous five minutes;
  deleting the final Passkey MUST additionally verify the fallback password during that
  operation.
- **FR-004**: Each M1 import MUST accept one ZIP representing exactly one book.
- **FR-005**: The system MUST recursively identify main Markdown candidates and MUST only
  auto-select a unique, error-free, high-confidence candidate.
- **FR-006**: A generic single Markdown candidate MUST require administrator confirmation;
  ambiguous or multi-book packages MUST be rejected without guessing.
- **FR-007**: The selected Markdown's directory MUST be the base for relative resources.
- **FR-008**: Archive and media processing MUST enforce every approved byte, count, pixel,
  depth, path, duration, and expansion limit against actual processed data.
- **FR-009**: Any import security violation MUST fail the whole import, remove incomplete
  output, and preserve every current publication.
- **FR-010**: Draft content, diagnostics, resources, and tasks MUST be visible only to the
  administrator and indistinguishable from nonexistent resources to anonymous visitors.
- **FR-011**: The preview MUST show candidate evidence, diagnostics, proposed navigation,
  page boundaries, content roles, and final displayed heading levels and titles.
- **FR-012**: M1 structure editing MUST support navigation inclusion, display-title override,
  display-level override, four content roles, and page starts before heading nodes.
- **FR-013**: M1 MUST NOT reorder body content, split inside non-heading blocks, or expose a
  page-alias editor.
- **FR-014**: Navigation exclusion MUST NOT remove the corresponding body content.
- **FR-015**: Publishing overrides MUST be stored in a portable, versioned configuration
  independent of the source Markdown and private reading data.
- **FR-016**: The published document MUST use semantic document elements for supported
  headings, blocks, tables, figures, formulas, code, footnotes, and semantic containers.
- **FR-017**: Raw imported HTML MUST be sanitized so executable content and unsafe resource
  URLs cannot reach preview or publication.
- **FR-018**: Every independently locatable block MUST receive an opaque stable identifier,
  current source position, normalized visible text, and a versioned fingerprint.
- **FR-019**: Complete parsing and rendering intermediates MUST be derived and rebuildable;
  they MUST NOT become a second editable body source.
- **FR-020**: Every published version MUST be complete and immutable before it can become the
  current version.
- **FR-021**: Search data MUST validate successfully before publication and MUST become
  current at the same visible boundary as the book version.
- **FR-022**: Readers MUST continue receiving the complete previous version during every
  background rebuild and any failed publication.
- **FR-023**: A stale build MUST NOT replace a newer source or publishing configuration.
- **FR-024**: Reader requests MUST use pre-generated published artifacts and MUST NOT perform
  parsing, formula rendering, highlighting, image processing, or indexing.
- **FR-025**: Public page resources MUST be version-pinned so a response cannot mix versions.
- **FR-026**: Search results MUST be limited to the current version and content visible to the
  requester.
- **FR-027**: Searches of three or more Unicode characters MUST search current metadata,
  headings, and body as a literal continuous phrase.
- **FR-028**: Searches of one or two characters MUST only search current titles, authors, and
  headings and MUST explain that body search requires at least three characters.
- **FR-029**: M1 MUST retain the uploaded MinerU ZIP as the registered original file for the
  version and make it downloadable when the book is public.
- **FR-030**: Complete and Range downloads MUST recheck current authorization, use a safe
  user-facing filename, support resumption, and prevent search indexing.
- **FR-031**: Internal configuration, manifests, indexes, notes, annotations, and storage
  paths MUST NOT appear in the public original-file download set.
- **FR-032**: Background work MUST have durable queued, running, completed, failed, canceled,
  and interrupted states that survive Web or worker restart.
- **FR-033**: Only one import or rebuild MAY execute at a time in M1.
- **FR-034**: Infrastructure interruption MAY trigger at most one automatic retry; content,
  limit, timeout, and repeat interruption failures MUST require explicit retry. Cancellation
  or timeout MUST allow no more than ten seconds for cooperative job-child shutdown before
  forced termination, and terminal state MUST wait for confirmed process closure.
- **FR-035**: Recovery MUST NOT automatically publish a ready, staging, quarantined, or
  orphaned version.
- **FR-036**: Startup reconciliation MUST isolate incomplete or inconsistent book versions
  without making unrelated books or administration unavailable.
- **FR-037**: The current and immediately previous verified publication MUST be retained;
  older versions MAY be reclaimed only after the approved grace period.
- **FR-038**: Private, draft, login, management, error, redirect, reading-resource, HTML, and
  download responses MUST follow their approved cache and indexing boundaries.
- **FR-039**: M1 publication MUST NOT require a rights-confirmation interaction, but the
  publish flow MUST preserve a policy extension point without fabricating confirmation data.
- **FR-040**: Operational records MUST identify jobs, books, versions, phases, durations, and
  safe failure categories without recording secrets, complete private content, or unsafe raw
  archive paths.

### Non-Functional Requirements

- **NFR-001**: Every HTML, resource, search, download, preview, task, and management path MUST
  enforce server-side authentication and authorization appropriate to its current book state.
- **NFR-002**: The system MUST preserve a complete verified publication across every tested
  build, index, transaction, process-interruption, and startup-recovery boundary.
- **NFR-003**: A public reading page served by the origin without a public-cache hit MUST meet
  a p95 response time of 300 ms on the reference single-server deployment.
- **NFR-004**: A background build MUST NOT delay access to the currently published version,
  even when processing the representative large-book fixture.
- **NFR-005**: One upload MUST accept up to 2 GiB compressed and 8 GiB actual extracted data,
  subject to all narrower approved file, image, path, count, time, and ratio limits.
- **NFR-006**: Every security, schema, publication, recovery, cache, download, search, and
  performance requirement MUST have automated fixture-based evidence before M1 completion.
  Final real-world compatibility and performance evidence MUST use the two or three
  several-hundred-page MinerU ZIPs supplied by the administrator during testing; small and
  synthetic fixtures MUST NOT substitute for that final evidence.
- **NFR-007**: Published artifacts MUST be reproducible from authoritative Markdown,
  publishing configuration, registered original files, and a supported compiler version.
- **NFR-008**: Every implementation commit after repository initialization MUST satisfy the
  approved Conventional Commits policy, with repository-managed local validation and CI
  validation of pull-request commits and the final pull-request title.
- **NFR-009**: Every substantive external code copy or adaptation MUST record an immutable
  source revision, source path, license, purpose, and local modifications. Code with an
  incompatible or unapproved license MUST remain behavior-only reference material unless a
  later explicit licensing decision permits reuse.

### Key Entities *(include if feature involves data)*

- **Book**: Stable identity, title, visibility, and current published-version reference.
- **Book Version**: Immutable source, configuration revision, generated representation,
  lifecycle state, integrity evidence, and predecessor.
- **Publishing Configuration**: Portable title, metadata, source description, structure
  overrides, roles, page starts, numbering, and original-file descriptors.
- **Document Manifest**: Derived pages, stable blocks, source locations, normalized text
  fingerprints, resources, hashes, and compiler identity for one version.
- **Import Job**: Durable state, attempt, lease, captured base/config revision, phase,
  timings, resource counters, and safe failure category.
- **Search Entry**: Version-scoped metadata, heading, or body block that resolves to a page
  and stable block.
- **Original File**: Registered immutable source attachment with role, safe display name,
  media type, size, hash, and owning version.
- **Administrator Credential**: Sole administrator session, fallback password account, and
  one or more named Passkeys.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An administrator can take a representative valid MinerU ZIP from upload through
  structure confirmation to a publicly readable book without manually rearranging the ZIP or
  editing configuration files.
- **SC-002**: All hostile and boundary fixtures are either accepted within the documented
  limits or rejected with no readable partial output; zero rejected fixtures alter the
  current publication.
- **SC-003**: Across injected failures at every publication boundary, anonymous readers see
  exactly one complete version and never a mixed or partial version.
- **SC-004**: At least 95% of uncached-origin public reading-page responses complete within
  300 ms on the reference deployment while a representative book is already published.
- **SC-005**: At least 95% of supported search requests complete within one second on the
  representative large-book fixture, and all results belong to the current visible version.
- **SC-006**: The documented Chinese, mixed-language, punctuation, formula, wildcard, and
  injection fixtures follow the specified normal or short-query branch with no query errors
  or unauthorized results.
- **SC-007**: A multi-gigabyte-capable original download can be interrupted and resumed with
  byte-identical output, while every unauthorized or newly private request is denied.
- **SC-008**: After Web, worker, and host restart scenarios, every durable job reaches a
  documented state, automatic retry never exceeds one attempt, and no ready/orphaned version
  becomes public.
- **SC-009**: The same authoritative inputs and compiler version reproduce matching manifest,
  page, resource, and search-content hashes for a published version.
- **SC-010**: Invalid commit messages are rejected by both the repository hook and CI, and a
  release audit finds no substantively copied or adapted external code without the required
  immutable provenance and license record.

## Assumptions

- MinerU runs on an external GPU-capable machine; M1 receives only its output ZIP.
- One installation has one administrator and one Web/worker deployment on one Linux host.
- The administrator can always access the server terminal for bootstrap and complete
  credential recovery.
- M1 receives one book per ZIP and does not attempt to split multi-book bundles.
- The uploaded ZIP is the only guaranteed original file in M1; PDF and EPUB attachment
  management arrives later.
- Publicly delivered content cannot be revoked from a reader who already saved it, but new
  anonymous requests stop immediately when a book becomes private.
- Formula failures may be diagnosed and displayed as source notation without blocking an
  otherwise valid publication.
- During the M1 test stage, the administrator will provide two or three real MinerU output
  ZIPs of several hundred pages each. They remain outside Git and are registered by opaque
  fixture ID, MinerU version, size, and SHA-256 before use.
- Conventional Commits are adopted for reviewable history only; M1 does not infer automatic
  releases or version numbers from commit messages.

## Out of Scope

- Running MinerU, OCR, or GPU work on the server
- EPUB import
- Complete library and folder management
- Body/chapter reordering in the preview
- Page alias editing
- Notes, highlights, annotations, bookmarks, progress, and personal reading settings
- Exact browser selection offsets and highlight migration
- Two-character full-body Chinese search
- Homepage, featured shelves, automatic cover design, and recycle-bin UI
- Multi-user accounts, public registration, collaboration, comments, or social features
- External queues, object storage, additional databases, microservices, or multi-instance
  deployment
- Forking a complete existing publishing application as the implementation baseline
- Semantic-release, Changesets, or another automatic release pipeline
