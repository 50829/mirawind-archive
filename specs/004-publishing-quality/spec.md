# Feature Specification: Publishing Quality Closure

**Feature Branch**: `[004-publishing-quality]`

**Created**: 2026-07-25

**Status**: Draft

**Input**: Preserve authoritative Markdown while identifying printed tables of contents as
reference-only source regions, use their hierarchy to improve the real body structure,
persist safe Chinese mixed-script preprocessing as the accepted Markdown, make preview
faithfully represent publication, and remove duplicated visual formulas.

## User Scenarios & Testing

### User Story 1 - Publish a book without a duplicated printed contents section (Priority: P1)

As the administrator, I can import a MinerU book whose paper table of contents was emitted
as Markdown headings and receive a proposed structure in which that printed contents region
is used as a reference but does not contaminate the published body.

**Why this priority**: A printed contents section currently corrupts navigation, numbering,
page boundaries, outlines and search throughout the whole book.

**Independent Test**: Import a book containing a printed contents region followed by the
same chapters in the body, accept the high-confidence proposal, publish it, and verify that
only the real body headings participate in the resulting book structure.

**Acceptance Scenarios**:

1. **Given** a clearly bounded printed contents region with at least three ordered entries
   that match later body headings, **When** background analysis prepares the draft, **Then**
   the preview identifies the source region, shows its matches and proposes the matched
   body hierarchy without modifying the Markdown.
2. **Given** a confirmed printed contents region, **When** the book is previewed or
   published, **Then** the region is absent from reading body, formal contents, outline,
   numbering, page splitting and search while remaining present in the frozen source.
3. **Given** flattened or inconsistent later Markdown heading levels, **When** printed
   contents entries match them in a unique monotonic order, **Then** the proposed display
   levels follow the printed hierarchy and remain continuous from level one through four.
4. **Given** a low-confidence, ambiguous or conflicting candidate, **When** analysis
   completes, **Then** it reports bounded diagnostics and leaves uncertain body structure
   unchanged instead of silently suppressing or remapping content.

---

### User Story 2 - Preview exactly what will be published (Priority: P2)

As the administrator, I can inspect the final pages, hierarchy, numbering, formulas and
diagnostics before publishing, and publication refuses to use a stale or different input.

**Why this priority**: A preview built through different semantics cannot serve as a safe
publication decision.

**Independent Test**: Build a multi-page preview, compare every semantic page with a
publication from the same captured inputs, then change the source or configuration and
verify that the earlier preview cannot be represented as current.

**Acceptance Scenarios**:

1. **Given** unchanged source, configuration revision and compiler identity, **When** a
   preview and a publication are built, **Then** their source-region treatment, page
   boundaries, heading semantics, numbering, body structure and diagnostics are identical
   apart from authorized URLs and their management or reader shells.
2. **Given** source or configuration changed after preview, **When** the administrator
   attempts to publish, **Then** the stale preview is rejected and a new preview is
   required.
3. **Given** a blocking structure, source-region or resource error, **When** preview is
   built, **Then** the error is located before publication and the old current version
   remains available.
4. **Given** an allowed formula or code fallback, **When** preview and publication are
   built, **Then** both show the same fallback content and diagnostic severity.
5. **Given** mixed Chinese, Latin and numeric prose imported with `zh-smart-v1`, **When**
   preprocessing and preview complete, **Then** the normalized Markdown is persisted,
   preview shows the exact prose that publication and search will use, bounded conversion
   provenance is recorded, and the original uploaded file remains unchanged.

---

### User Story 3 - Read clean prose and formulas with accessible semantics (Priority: P3)

As a reader, I see legible Chinese mixed-script prose and each formula once in its intended
typeset form while assistive technology retains access to its mathematical representation.

**Why this priority**: Inconsistent mixed-script spacing, half-width Chinese punctuation and
missing renderer assets make generated pages unnecessarily difficult to read.

**Independent Test**: Publish a page containing Chinese, English, numbers, technical tokens,
inline formulas and display formulas; confirm exact typography normalization, protected
content, one visual formula representation, local assets and accessible mathematics.

**Acceptance Scenarios**:

1. **Given** valid inline and display formulas, **When** a preview or reading page loads,
   **Then** each formula has exactly one visible representation and its MathML remains
   available to assistive technology.
2. **Given** a supported browser, **When** it requests formula styling and fonts, **Then**
   all assets are served locally under the matching renderer identity with immutable cache
   behavior and without access to book-private data.
3. **Given** invalid formula source, **When** compilation completes, **Then** preview and
   publication show the same original-source fallback and diagnostic without duplicating
   the fallback.
4. **Given** an already published old renderer version, **When** this repair is deployed,
   **Then** its immutable directory is unchanged and a corrected book is created only by a
   normal new publication.
5. **Given** ordinary mixed prose and protected code, math, URLs, email addresses, paths,
   versions, times and decimal values, **When** `zh-smart-v1` is applied once or repeatedly,
   **Then** Chinese/Latin and Chinese/digit boundaries use one readable space, Chinese
   punctuation is full-width where specified, protected tokens are byte-identical, and a
   second pass makes no further change.

---

### User Story 4 - Rebuild safely across configuration versions (Priority: P4)

As the administrator, I can continue to preview or republish existing version-one book
configurations while new drafts record the reference-only source regions explicitly.

**Why this priority**: Quality repair must not strand existing drafts or mutate published
versions.

**Independent Test**: Load strict version-one and version-two fixtures, migrate the
version-one configuration, rebuild both, and verify deterministic results, strict rejection
of malformed or unsupported configurations and preservation of the previous current
version on failure.

**Acceptance Scenarios**:

1. **Given** a valid version-one configuration, **When** it is loaded for editing or
   rebuilding, **Then** it is interpreted as containing no source regions and can be
   deterministically migrated to version two without changing existing heading behavior.
2. **Given** a version-two source region, **When** its bounds or digest do not match the
   captured Markdown, **Then** preview and publication reject it without removing content.
3. **Given** unknown fields, overlapping regions, excessive entries or an unsupported
   schema version, **When** configuration is validated, **Then** it is rejected with safe
   bounded diagnostics.
4. **Given** any failed rebuild, **When** readers request the book, **Then** they continue
   to receive the complete previous current version.

### Edge Cases

- A book contains a heading named “目录” that is an ordinary chapter rather than a printed
  contents region.
- A printed contents region contains only one or two entries, no page numbers, malformed
  numbers, Roman numerals, appendices or mixed Chinese and Latin numbering.
- Printed contents entries repeat titles such as “习题” or “参考文献” across chapters.
- Body headings omit entries, introduce additional entries, reorder sections or use
  inconsistent numbering.
- Multiple printed contents candidates or nested mini-contents sections appear.
- Source ranges are empty, overlap, split a block, exceed the source, or were captured from
  a different Markdown digest.
- A printed contents region contains images, tables, footnotes, links or other content that
  must not be silently discarded by an uncertain proposal.
- A formula page contains no formulas, thousands of formulas, invalid TeX, very large
  expansions, right-to-left text or mixed CJK and Latin glyphs.
- Mixed prose contains pre-existing spaces, line breaks, emoji, full-width characters,
  nested emphasis, links, image alternative text, unmatched quotes or punctuation beside
  code and formulas.
- A prose fragment resembles a decimal, thousands-separated number, version, time, URL,
  email address, file name, path, DOI or ISBN and therefore must not be partially converted.
- A renderer asset is missing, has the wrong media type or renderer identity, or fails
  integrity validation.
- Preview or publication is interrupted between compilation, durable staging, version
  registration, search indexing and current-version switching.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST retain every byte of the accepted main Markdown in the draft
  source and each immutable publication source even when a source region is excluded from
  derived reading content.
- **FR-002**: The system MUST detect printed-contents candidates only from bounded source
  evidence that includes an explicit contents boundary and ordered evidence linking entries
  to later body headings.
- **FR-003**: Candidate analysis MUST produce a confidence, source bounds, extracted entry
  count, matched body-heading count and at most 100 safe conflict diagnostics per candidate.
- **FR-004**: Automatic structure application MUST require at least three recognized
  entries, at least three unique exact later-body matches, at least 80% match coverage,
  one-to-one monotonic order, continuous levels and no rich-content or cross-reference
  conflict; all other candidates MUST leave uncertain structure unchanged for administrator
  review.
- **FR-005**: The administrator MUST be able to inspect and reverse each proposed
  reference-only region and its body-heading mappings before publication.
- **FR-006**: A confirmed reference-only printed contents region MUST be excluded from
  derived reading body, formal table of contents, page outline, automatic numbering, page
  splitting and search data.
- **FR-007**: Excluding a printed contents region MUST NOT change the behavior of ordinary
  `include_in_toc` controls or hide ordinary source content.
- **FR-008**: Printed page numbers MUST be retained only as diagnostic or matching evidence
  and MUST NOT determine web page identities or boundaries.
- **FR-009**: Matched printed-contents hierarchy MAY propose body `display_level`, content
  role and page starts, but resulting heading levels MUST remain continuous and within the
  supported semantic range.
- **FR-010**: Configuration MUST record at most 32 confirmed source regions and 20,000
  title-free entry mappings as portable UTF-8 byte ranges and hashes tied to the exact main
  Markdown and region content and MUST NOT store a second editable body.
- **FR-011**: Version-one configurations MUST remain readable and migrate deterministically
  to version two as configurations with no source regions and typography provenance
  `preserve-v1` whose input and output digests equal the existing main Markdown digest.
- **FR-012**: Version-two validation MUST reject unknown fields, unsupported versions,
  invalid or overlapping ranges, range digest mismatches, excessive regions and regions
  that do not align to complete top-level source blocks.
- **FR-013**: Preview and publication MUST use the same parsing, normalization,
  reference-only filtering, configuration validation, numbering, splitting, formula/code
  rendering and diagnostic classification.
- **FR-014**: Preview MUST render the same number of pages and the same semantic body and
  outline per page that publication would produce from the same captured inputs.
- **FR-015**: Preview MUST record source, configuration, compiler, renderer and semantic
  output identities; stale input MUST invalidate the preview before publication.
- **FR-016**: Preview URLs and assets MUST remain authenticated, private and non-cacheable;
  public and private reader response behavior MUST remain governed by the published book's
  existing visibility rules.
- **FR-017**: Blocking diagnostics from preview and publication MUST be identical and MUST
  preserve the previous current version.
- **FR-018**: The system MUST provide the matching local formula stylesheet and fonts for
  every generated KaTeX representation under a versioned renderer identity.
- **FR-019**: Valid formulas MUST expose one visible typeset representation and retain an
  accessible MathML representation; the repair MUST NOT remove MathML.
- **FR-020**: Invalid formulas MUST show the original notation once and produce the same
  non-blocking diagnostic in preview and publication.
- **FR-021**: Renderer assets MUST contain no book content, require no user-specific
  response variation and be safe for immutable public caching.
- **FR-022**: Correcting a published book MUST create and atomically publish a new immutable
  version; existing published version directories MUST NOT be modified in place.
- **FR-023**: Search data and presentation projections MUST be generated only after
  reference-only filtering and MUST include only the current successfully published
  version.
- **FR-024**: The management preview MUST present source-region and mapping diagnostics in
  bounded groups that remain usable for a representative large MinerU book.
- **FR-025**: The implementation MUST provide an explicit publication-quality gate covering
  invalid source regions, structure conflicts, resource closure, renderer assets and stale
  preview identities.
- **FR-026**: Version-two configuration MUST require
  `source.preprocessing.typography` with a profile, input digest, output digest and bounded
  aggregate counts; accepted profiles are `preserve-v1` and `zh-smart-v1`, new imports MUST
  default to `zh-smart-v1`, and migrated version-one configurations MUST use `preserve-v1`.
- **FR-027**: Typography preprocessing MUST run in a worker after hostile import validation
  and main-document selection but before the main Markdown is accepted, hashed, assigned
  stable block IDs or analyzed for printed contents. Its output MUST be atomically
  persisted as `source.main_markdown`; reader and preview HTTP requests MUST NOT run it.
- **FR-028**: `zh-smart-v1` MUST process visible prose text in headings, paragraphs, lists,
  block quotes, tables, footnotes, captions and non-technical link labels, while skipping
  code, inline code, math, inline math, raw HTML, link destinations and recognized technical
  tokens including URLs, email addresses, paths, file names, versions, times, decimals,
  thousands-separated numbers, DOI and ISBN identifiers.
- **FR-029**: At a direct Han-to-Latin-letter, Latin-letter-to-Han, Han-to-Arabic-digit or
  Arabic-digit-to-Han boundary in eligible prose, `zh-smart-v1` MUST normalize horizontal
  spacing to exactly one ASCII space without changing explicit line breaks.
- **FR-030**: In eligible Chinese prose context, `zh-smart-v1` MUST apply the exact
  neighbor, pairing, precedence and whitespace rules in
  `contracts/source-preprocessing.md` to convert ASCII comma,
  semicolon, colon, question mark, exclamation mark, sentence-ending period, a confidently
  paired parenthesis pair, a confidently paired double-quote pair and three-dot ellipsis
  into `，；：？！。“”（）……` as applicable, remove spaces immediately inside Chinese paired
  punctuation and before Chinese closing punctuation, and leave ambiguous pairs unchanged.
- **FR-031**: The preprocessor MUST use parsed Markdown context to select eligible source
  text ranges, apply only minimal non-overlapping UTF-8 replacements, preserve all
  non-target bytes and explicit line breaks, and avoid whole-document AST serialization.
  Printed-contents detection, ranges, stable IDs, preview, publication and search MUST all
  consume the persisted normalized Markdown.
- **FR-032**: Preview MUST expose the applied typography profile, input/output digests and
  bounded counts for inserted or normalized spaces, punctuation conversions and protected
  nodes without exposing complete private source fragments.
- **FR-033**: Original uploaded files MUST remain immutable under existing `original_files`
  handling and serve as the re-import source. An explicit re-preprocess action MUST create a
  new source/configuration revision and preview, invalidate any older ready preview, and
  MUST NOT rewrite an existing published version or silently process old books on deploy.

### Non-Functional Requirements

- **NFR-001**: All Markdown parsing, source-region analysis, formula rendering, code
  highlighting, page splitting and search generation MUST remain outside reader and preview
  HTTP request paths.
- **NFR-002**: A representative uncached reading response MUST retain the existing 300 ms
  p95 server-response target while background analysis or publication runs.
- **NFR-003**: Printed-contents analysis MUST be deterministic, bounded to at most 20,000
  headings and 256 MiB of accepted main Markdown, and MUST NOT invoke an external model or
  network service.
- **NFR-004**: Candidate and validation diagnostics MUST cap each candidate at 100
  diagnostics and each displayed source label at 500 characters; complete private body
  content and unbounded archive data MUST NOT enter logs.
- **NFR-005**: Formula renderer assets MUST be local, integrity-controlled, have correct
  media types and support long-lived immutable caching without cookies.
- **NFR-006**: Configuration migration and validation MUST have strict version-one and
  version-two fixtures, unknown-new-version rejection, semantic cross-field tests and
  deterministic round-trip evidence.
- **NFR-007**: Preview and publication interruption, cancellation, retry and crash behavior
  MUST leave no partial current version and MUST keep the last verified version readable.
- **NFR-008**: The feature MUST pass representative and stress MinerU regressions including
  printed contents, dense formulas and the existing current-version performance workload.
- **NFR-009**: Typography normalization MUST be deterministic, idempotent, bounded by the
  accepted Markdown size and AST limits, require no network service, write atomically, and
  emit at most one aggregate summary whose counters do not exceed 2,147,483,647 rather
  than unbounded per-token diagnostics.

### Key Entities

- **Printed Contents Candidate**: A bounded analysis result with source range, confidence,
  extracted entry count, later body matches and conflicts; it is derived and disposable.
- **Confirmed Source Region**: Portable publishing configuration identifying an exact
  Markdown range as printed-contents reference-only content.
- **Heading Match**: A unique ordered relationship between a printed entry and a later real
  body heading used to propose display structure.
- **Semantic Compilation**: A deterministic result containing filtered normalized content,
  pages, headings, diagnostics and semantic identities before preview or publication wraps
  it in different authorized URLs.
- **Renderer Asset Set**: Immutable local styles and fonts whose identity matches generated
  formula markup.
- **Typography Provenance**: A versioned source record containing the applied profile,
  input/output digests and aggregate counts for the persisted normalized Markdown.
- **Normalized Main Markdown**: The post-preprocessing authoritative body used for all
  structure analysis, preview, publication and rebuilds.

## Success Criteria

### Measurable Outcomes

- **SC-001**: In the representative printed-contents book, zero printed-contents entries
  appear in reading body, formal navigation, page outlines, automatic numbering or search
  after the accepted proposal is published.
- **SC-002**: Every uniquely matched body heading in the representative fixture receives
  the expected continuous level, while every ambiguous or unmatched entry is reported and
  leaves body structure unchanged.
- **SC-003**: For unchanged inputs, preview and publication have identical page counts,
  heading levels, numbering, body semantics and diagnostic codes across all feature
  fixtures.
- **SC-004**: Browser validation of inline and display formula fixtures reports exactly one
  visible representation per formula, an accessible MathML representation and zero missing
  stylesheet or font responses.
- **SC-005**: All supported version-one configurations continue to build with their prior
  behavior, and 100% of version-one migration fixtures produce valid deterministic
  version-two configurations.
- **SC-006**: Source-region, migration, stale-preview, renderer-asset, publication recovery,
  search exclusion and immutable-version tests pass with no unmitigated critical finding.
- **SC-007**: Representative uncached reader responses remain at or below 300 ms p95 during
  a background rebuild.
- **SC-008**: An administrator can review and accept or reverse the proposed printed
  contents treatment without editing raw configuration or individually changing hundreds
  of heading checkboxes.
- **SC-009**: Every typography fixture produces its exact expected normalized Markdown,
  keeps every protected token and non-target byte unchanged, produces zero changes on a
  second pass, preserves the original uploaded fixture, and has identical persisted source,
  preview, published HTML and search text.

## Assumptions

- Existing authentication, authorization, hostile archive handling, publication
  transaction and current-version rules remain authoritative.
- Printed contents detection is deterministic and evidence-based; external language models
  are not required.
- The administrator accepts high-confidence defaults by reviewing the generated preview and
  can reverse them before publication.
- Existing published configurations contain no source regions or preprocessing provenance
  and therefore migrate as `preserve-v1`; neither their source nor published directory is
  automatically rewritten.
- New imports default to `zh-smart-v1`; selecting `preserve-v1` or reapplying a newer
  profile is an explicit source-preparation action, not a reader preference.
- Local real MinerU fixtures remain private and are referenced in tracked evidence only by
  their approved opaque identifiers.

## Out of Scope

- Manual WYSIWYG editing or destructive in-place rewriting of a published Markdown body.
- General-purpose OCR correction or WYSIWYG Markdown editing.
- General copy-editing, grammar correction, word segmentation, traditional/simplified
  conversion or punctuation inference beyond the closed `zh-smart-v1` rules.
- Using printed page numbers as web pagination.
- Reordering body sections from the contents editor.
- External or model-assisted contents recognition.
- EPUB navigation import, annotations, notes, bookmarks and reading settings.
- In-place repair of immutable published version directories.
