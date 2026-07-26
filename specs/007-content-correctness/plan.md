# Implementation Plan: Content Correctness

**Branch**: `007-content-correctness` | **Date**: 2026-07-27 | **Spec**: `spec.md`

## Summary

Replace the prototype seven-book/reference-v1 path with a strict per-book reference v2 and
use it to drive a bounded worker-only reconstruction pipeline: stream MinerU flat layout
evidence, discover all printed-contents regions, align the canonical entries to body headings,
infer semantic hierarchy and independent splits, preserve protected text, and surface every
uncertain decision as an executable workbench diagnostic. Rebuild references for all fifteen
books by Codex PDF image recognition; do not migrate v1 expectations.

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js 24, Astro 5, React 19

**Primary Dependencies**: unified/remark, `yauzl`, Zod, SQLite, Poppler CLI, Tesseract CLI

**Storage**: existing SQLite WAL and local data root; local ignored reference JSON

**Testing**: Vitest unit/contract/integration/component, Playwright, local fixture gates,
build/read benchmarks

**Target Platform**: one Linux host; one Astro web process and one same-codebase worker

**Performance Goals**: every preparation under 30 minutes; OCR under 10 minutes; existing
uncached public read p95 no more than 300 ms

**Constraints**: hostile ZIP/PDF/sidecar input, streaming limits, cancellation, immutable
published versions, no analysis on reader requests, no new service/database

**Scale/Scope**: fifteen correctness books (at least 73 image-recognized printed pages); separate
three-real-book plus 500-page synthetic performance suite; up to 20,000 sidecar rows

## Constitution Check

- **Authority**: Markdown plus `book.yaml` v3 remain editable authority. Reference v2 is
  local acceptance evidence; layout/OCR/alignment/diagnostics are private derivations.
- **Publication**: no published file or current pointer is mutated. Existing drafts require
  explicit v4 reprocessing.
- **Security**: ZIP and companions retain archive defenses; sidecar and OCR inputs are bounded;
  temporary files are isolated and deleted; diagnostics exclude full private content.
- **Request path**: all analysis runs in `prepare_draft`; preview and reader consume artifacts.
- **Evidence**: strict schema, negative, cancellation, cleanup, exact 15-book and separate
  performance gates are tasks before completion.

Gate result: PASS. No constitution exception or schema transition is required.

## Architecture

### 1. Reference v2 and review pack

Store one ignored file at `tests/fixtures/mineru/real/references-v2/<fixture-id>.json`. A
repository parser validates exact fields, hash bindings, page/region consistency, unique
canonical region, complete raw-heading disposition and diagnostics. It accepts only version 2. Delete the combined v1 parser/generator/data path.

The review-pack command safely extracts one registered archive into a temporary directory and
emits only observations: file hashes, PDF page images/text, raw Markdown root blocks/headings,
sidecar rows and production output in a separate observed section. It must not import
`printed-toc.ts` or `structure-proposal.ts` and must never populate expected decisions.

For each of the eight newly added books, Codex MUST render and open every candidate printed-
contents PDF page with the image-recognition tool, read every logical row, resolve columns,
indentation, continued lines and semantic kind from the page image, and directly author those
decisions as reference v2 ground truth without human adjudication. The same image-review
procedure is rerun for the original seven rather than copying v1. Native/OCR text and MinerU
rows are navigation aids only; production proposals are shown after the expected reference is
saved and can only produce a comparison report, never fill or revise expected decisions.

The comparator independently validates actual preparation against every expected decision;
missing, extra, order, boundary, match, level, role, TOC, split, protection and diagnostic
differences fail with bounded fixture/anchor codes.

### 2. Bounded evidence extraction

Replace whole-file JSON parsing with a streaming parser for the flat sidecar. Expand each
`list_items` element as an ordered child record; when item boxes are absent preserve group
order rather than inventing coordinates. Clamp file bytes, nesting, records, page indices,
text and coordinates while honoring `AbortSignal`.

Reconstruct page reading order as 1-3 columns using bbox clusters. Join wrapped rows only
under page/column/vertical/numbering constraints. Keep provenance and group identity for
diagnostics.

### 3. Printed region discovery

Generate candidates from exact standalone labels, continuous/spaced leaders, right-aligned
page suffixes and early repeated-title runs. Extend until the last reliable row using local
gaps and recurrence evidence rather than a fixed page window. Score frontmatter position,
density, monotonic page labels and later body recurrence; penalize reverse recurrence and late
index position. Return multiple disjoint exclusions and one canonical source.

Boundary confidence is computed without global body coverage. Each logical entry records
numbering, indent, kind, range and confidence independently.

### 4. Alignment, hierarchy and splits

Build a sparse candidate graph with normalized numbering/title similarity. Dynamic programming
uses match, entry-skip and heading-skip transitions; retain best and second-best paths so a pair
is accepted only above score and margin thresholds. Duplicate-title maps preserve occurrence
and candidate sets.

Hierarchy precedence is semantic kind, explicit numbering depth, canonical indentation, body
context, then MinerU source level. Part resets h1 and makes enclosed Chapter h2; descendants
shift and clamp to h4. Chapter without Part and Appendix/backmatter reset h1. Close gaps but do
not flatten reliable depth. Include reliable body-only numbered and clear unnumbered major
units with explicit evidence.

Splits are a separate pass: Part, later Chapter, Appendix and major front/back units split;
the first Chapter immediately following a Part does not. Ordinary sections default false.

### 5. OCR fallback and analysis artifact

When sidecar/native evidence cannot establish a boundary, raster only candidate pages among
the first 48 at 150 DPI and run Tesseract with `eng+chi_sim`. Enforce 15 seconds per page,
10-minute aggregate and the outer job signal/deadline. Process execution uses argument arrays,
bounded stdout/stderr and an isolated temporary directory deleted in `finally`.

Persist a private `printed-contents-analysis-v2` artifact containing hashes, regions, entry
decisions, best/second-best margins and bounded diagnostics. It is derived, revision-pinned
and never exposed through public assets.

### 6. Diagnostics and identities

Carry preparation diagnostics into the draft DTO with stable location and recovery. The
workbench selects block/region/page/fragment, supports reload, region enablement and verbatim
reprocess where valid, and restores dialog trigger focus. Dirty and conflict behavior remains
unchanged.

Set preparation and preview identities to `prepare-draft-v4` and `draft-preview-v4`. Do not
change `book.yaml`, database, compiler-v4, semantic renderer or reader identities.

## Project Structure

```text
scripts/fixtures/
├── create-mineru-reference-pack.ts
├── compare-mineru-references.ts
└── mineru-reference-v2.ts
src/compiler/document/
├── layout-evidence.ts
├── printed-toc.ts
├── structure-proposal.ts
└── printed-contents-analysis.ts
src/compiler/preprocess/typography.ts
src/jobs/handlers/prepare-draft.ts
src/jobs/handlers/build-preview.ts
src/components/preview/
tests/unit/{compiler,fixtures,components}/
tests/integration/recovery/
tests/fixtures/mineru/{synthetic,real/references-v2}/
```

## Delivery Sequence

1. Freeze D-114 and all 007 contracts; analyze before implementation.
2. Write failing strict-v2/parser/comparator/review-pack tests; remove v1 only when v2 passes.
3. Write failing streaming/list/column/cancellation tests and implement evidence extraction.
4. Write failing multi-region/index/alignment/hierarchy/split tests and implement pipeline.
5. Write failing OCR budget/cleanup tests and implement fallback/artifact.
6. Propagate diagnostics and identities with integration/component tests.
7. Render every candidate contents page, use Codex image recognition to read all pages of the
   eight new books and re-recognize the original seven, then author fifteen references and run
   exact and performance gates.
8. Run full gates, analyze/converge, complete appended tasks and rerun converge.

## Complexity Tracking

Sparse alignment and optional OCR are justified by observed duplicate/omitted headings and
image-only contents. Both remain bounded worker components; no new runtime service or editable
authority is introduced.
