# Implementation Plan: Publishing Quality Closure

**Branch**: `[004-publishing-quality]` | **Date**: 2026-07-25 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/004-publishing-quality/spec.md`

## Summary

Add a deterministic preprocessing stage that identifies high-confidence printed tables of
contents, records confirmed reference-only source regions in `book.yaml` v2, filters those
regions from derived publication content, and uses their ordered entries plus body numbering
to propose the real heading hierarchy. Add idempotent import-time Markdown preprocessing
for Chinese mixed-script spacing and punctuation while protecting technical tokens, then
persist its output as the accepted main Markdown. Refactor preview and publication to share
configured document preparation, pagination and semantic rendering. Deliver pinned local
KaTeX CSS and font assets under the renderer identity so MathML remains accessible without
appearing as a second visual formula. Carry the repaired configured heading hierarchy into
the published reader as a generated expandable full-book tree, current-location breadcrumb
and scroll-aware page outline.

## Technical Context

**Language/Version**: TypeScript 6.0 on Node.js 24

**Primary Dependencies**: Astro 7, React 19 management islands, unified/remark/rehype,
KaTeX 0.18.1, AJV 8, YAML 2, better-sqlite3 12

**Storage**: Versioned `book.yaml`, immutable local version directories, SQLite WAL for
configuration/preview/job/version state, local renderer package assets

**Testing**: Vitest unit/contract/integration projects, Playwright browser tests, build/read
benchmarks and private real-MinerU fixture audits

**Target Platform**: One Linux host with one Astro Web process and one same-codebase worker

**Project Type**: Server-rendered web application with an offline document compiler

**Performance Goals**: Preserve uncached reader p95 at or below 300 ms during background
rebuild; analyze up to 20,000 headings and 256 MiB Markdown within the existing 30-minute
job limit; keep preview models and diagnostics bounded

**Constraints**: No reader-request parsing/rendering/indexing, no external model or CDN, no
in-place published-version repair, hostile source validation before preprocessing, minimal
and atomic Markdown replacements, strict schema versions, idempotent/protected typography,
old current version retained on every failed build

**Scale/Scope**: Three registered real MinerU 3.4.4 books (583, 441 and 97 pages), a
500-page synthetic stress book, up to 20,000 headings, formula-dense pages and existing
1,000-book library benchmark

## Constitution Check

_GATE: Passed before Phase 0 and re-checked after Phase 1._

- **Authority & schemas — PASS**: Post-preprocessing Markdown is the body authority.
  `book.yaml` v2 is the only portable authority for confirmed source-region treatment and
  heading overrides plus preprocessing provenance. v1 remains readable and migrates
  deterministically to v2 with `preserve-v1`. Original uploads remain immutable provenance;
  ASTs, candidates, pages, HTML, renderer diagnostics, manifests and search remain derived.
- **Atomicity & recovery — PASS**: Preview artifacts are private and replaceable.
  Publication continues to build and validate a complete immutable version before ready
  registration and the existing current-pointer transaction. A failure never changes the
  current version.
- **Security boundary — PASS**: Source-region analysis operates only after hostile archive
  acceptance and observes existing Markdown limits. Diagnostics omit unbounded private
  content. Preview remains authenticated `no-store`; renderer CSS/fonts contain no book
  data and use an exact public whitelist with immutable caching.
- **Request-path budget — PASS**: Detection, filtering, structure mapping, KaTeX rendering,
  page splitting and indexing execute only in worker jobs. Preview and reader requests read
  generated files. The renderer-asset endpoint serves only pinned package bytes.
- **Evidence — PASS**: Synthetic printed-contents fixtures cover positive, ambiguous,
  malformed and overlapping cases; typography fixtures cover exact output, protected
  tokens and idempotency; schema fixtures cover v1/v2; browser evidence covers computed
  prose and KaTeX visibility/fonts; publication/recovery/search tests and all registered
  real fixtures complete the release evidence.
- **Simplicity — PASS**: No process, service, database, queue or network dependency is
  added. One shared compiler preparation module replaces the second preview renderer.

## Project Structure

### Documentation

```text
specs/004-publishing-quality/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── book-config-v2.md
│   ├── management-preview.md
│   ├── source-preprocessing.md
│   └── renderer-assets.md
├── checklists/
└── tasks.md
```

### Source Code

```text
src/
├── compiler/
│   ├── preprocess/
│   │   └── typography.ts
│   ├── document/
│   │   ├── printed-toc.ts
│   │   ├── source-regions.ts
│   │   ├── configured-document.ts
│   │   ├── structure-proposal.ts
│   │   └── validate-config.ts
│   ├── render/
│   │   └── document.ts
│   └── version-builder.ts
├── jobs/handlers/
│   ├── prepare-draft.ts
│   └── build-preview.ts
├── schemas/
│   ├── book-config.ts
│   └── versioning.ts
├── services/
│   └── config-revisions.ts
├── components/preview/
└── pages/api/manage/books/[bookId]/

docs/
├── schemas/
│   ├── book.v1.schema.json
│   ├── book.schema.json
│   └── examples/
└── third-party/

scripts/
└── prepare-renderer-assets.mjs

public/_astro/renderers/semantic-html-v3-katex-0.18.1/  # generated, ignored

tests/
├── contract/
├── unit/compiler/
├── integration/compiler/
├── integration/recovery/
└── e2e/
```

**Structure Decision**: Keep the existing single application. Printed-contents and
source-region behavior live beside the normalized document model; configured document
preparation becomes the shared seam used by preview and publication. Pinned renderer assets
join Astro's verified static build closure without adding an application request handler.

## Design

### Source-region configuration

- Freeze the current schema as `book.v1.schema.json`; make `book.schema.json` current v2.
- v2 requires a bounded `source_regions` array. A printed-contents region contains an
  opaque region ID, `printed_toc` kind, `reference_only` disposition, accepted source
  path/hash, a half-open UTF-8 byte range and digest, plus bounded entry byte ranges,
  reference levels and optional matched body heading IDs. It stores no entry title text.
- The main Markdown SHA-256 continues to bind the whole configuration. Semantic validation
  additionally requires sorted non-overlapping region and entry ranges, complete root-block
  boundaries, matching hashes, unique monotonic external heading targets and configured
  heading identity for every source heading.
- The existing `structure` array retains entries and stable IDs for headings inside
  reference-only regions. This makes removal of a region reversible without inventing
  identities. Only the active filtered heading sequence participates in continuity,
  roles, numbering, pages, manifest, outline and search.
- v1 validation remains strict. Editing a v1 draft presents an in-memory v2 migration with
  `source_regions: []` and `source.preprocessing.typography.profile: preserve-v1`; saving
  creates the next v2 revision. New imports persist `zh-smart-v1` output before config
  generation. Published v1 files remain unchanged and rebuild with legacy no-region source.

### Printed-contents analysis

- Start only from an AST heading whose normalized title is an explicit localized contents
  label.
- Extract bounded candidate entries from complete following root blocks, recognizing
  chapter/appendix identifiers, dotted numeric section identifiers, dot leaders and
  trailing printed page labels.
- Locate the candidate end using ordered repeated evidence in later body headings. Require
  at least three unique monotonic matches and a high match ratio before applying a default
  reference-only region.
- Normalize titles conservatively for matching; chapter/section identifiers and order
  disambiguate repeated labels. Do not use ordinary fuzzy similarity to suppress content.
- Derive body display levels first from matched printed hierarchy, then from explicit body
  numbering for deeper headings. Unmatched or ambiguous headings retain the ordinary
  proposal. Emit bounded conflict diagnostics.

### Shared semantic preparation

- Introduce one configured-document function that parses normalized content already assigned
  stable heading IDs, validates source regions and structure, filters reference-only root
  blocks, numbers active headings and splits pages. It consumes already-preprocessed
  Markdown and never rewrites source.
- `buildPreview` and `buildImmutableVersion` call this function and the same
  `renderSemanticDocument`. The obsolete preview-specific Markdown renderer is removed.
- Preview emits every resulting page plus structured diagnostics, source-region proposal
  summary, aggregate typography summary, compiler/renderer identity, captured source/config
  hashes and a canonical semantic digest that excludes authorized URL differences.
- The publish action accepts only the ready preview for the exact source, revision and
  current compiler/renderer identity; deploys that change identities invalidate old
  previews.

### Persisted Chinese mixed-script preprocessing

- Add required `source.preprocessing.typography` provenance to v2 with the closed profiles
  `preserve-v1` and `zh-smart-v1`, input/output digests and bounded counts.
- After hostile archive validation and main-document selection, parse Markdown to identify
  eligible text slices. Apply minimal non-overlapping UTF-8 replacements, atomically store
  the result as `source.main_markdown`, then compute its digest, stable block IDs,
  printed-contents ranges and configuration.
- Normalize direct Han/Latin and Han/Arabic-digit boundaries to one ASCII space. Convert
  the approved ASCII punctuation only in Chinese prose context; paired parentheses and
  double quotes require a complete confident pair, and unmatched punctuation is retained.
- Skip code, inline code, math, inline math, raw HTML, link destinations and recognized
  URL/email/path/file/version/time/decimal/thousands/DOI/ISBN tokens. Preserve explicit
  line breaks and every non-target byte.
- Return only bounded aggregate counters and keep the original uploaded artifact immutable.
  Unit fixtures assert exact Unicode output, protected-token/non-target-byte identity and
  second-pass idempotency; preview/publication/search tests assert the persisted source is
  their one shared input. Reprocessing is an explicit new source/config revision, never a
  read-time or silent deployment action.

### Formula renderer assets

- Pin one KaTeX 0.18.1 engine for validation and rehype rendering; reject a dependency graph
  that would generate markup with a second KaTeX version.
- Before dev/build, deterministically generate
  `public/_astro/renderers/semantic-html-v3-katex-0.18.1/` from the pinned dependency:
  woff2-only minified CSS, its 20 referenced WOFF2 files, license and an integrity manifest.
  Verify filenames, version, URLs and digests before Astro copies it into `dist/client`.
- Both preview fragments and published HTML link the same renderer stylesheet. Astro's
  immutable `/_astro/` handling serves these application assets without Web-process
  document work or book-specific authorization.
- Increase compiler renderer identity to `semantic-html-v3-katex-0.18.1`; old immutable
  HTML remains untouched and can be corrected only by normal republishing.

### Generated reader navigation

- Build a flat bounded reader-navigation input from the same active numbered headings and
  page map that produce `document-manifest.json`; links use the canonical book key, page
  alias or ID and stable heading fragment.
- Convert the flat continuous heading sequence into a semantic nested tree. Native
  `details` branches on the current page's ancestry are initially open and remain
  independently keyboard-toggleable without requiring client state.
- Derive the top breadcrumb from the first active current-page heading and its ancestors.
  Derive the right outline only from active current-page TOC headings, retaining configured
  levels and smaller navigation typography.
- Extend the existing bounded inline progressive-enhancement script only for scroll/hash
  `aria-current="location"` state. It does not parse source or infer hierarchy, and the
  complete navigation remains ordinary server-generated links when script execution fails.

## Post-Design Constitution Check

All six gates remain passed. The design adds one portable schema version and one generated
public static-asset class, both required by accepted decisions D-101 through D-104, and
implements D-105 solely inside the existing publication compiler and reader shell. None
adds another authority, runtime service, reader computation path or mutable publication
pointer.

## Complexity Tracking

No constitution violations require justification.
