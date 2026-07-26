# Research: Content Correctness

## Fifteen-book evidence audit

The original seven and eight newly supplied MinerU 3.4.4 bundles contain original/layout
PDFs, one main Markdown and flat/nested sidecars. The new eight add 4,983 PDF pages, 6,290
Markdown headings and 11,391 flat `list_items`; 6,157 headings (97.9%) are H2. At least 73
printed-contents pages require Codex visual inspection across the complete set. One original book has no
printed contents. One has both Brief Contents and full Contents, both of which must be
excluded while only the full region supplies canonical hierarchy.

Late indexes produce contents-like false positives in several books. Therefore a label,
leader or page suffix alone is insufficient, and Markdown heading depth is not hierarchy.

## Reference v1 versus v2

Reference v1 is a combined proposal-derived snapshot: one source byte range, a flat list of
title fingerprints/levels/splits and no complete raw-heading accounting. Its generator imports
production parsing/proposal behavior and can turn current output into expected output, so it
cannot independently detect the defects under repair. Byte offsets also become stale after
preprocessing.

Reference v2 is per book, strict and authored by Codex from direct PDF image recognition. It models absent or
multiple contents, a unique canonical region, root-block anchors, semantic kinds, complete
heading disposition, protected ranges and expected diagnostics. The final repository supports
v2 only. v1 files and code are deleted, not migrated.

## Evidence fusion

Priority is explicit semantic/numbering grammar, frontmatter position and later body
recurrence, canonical page order/relative indentation, sidecar bbox/list order, then Markdown
source level.

No single signal works across the set:

- exact labels miss unlabelled lists;
- dot leaders miss ordinary right-aligned page numbers;
- bbox indentation alone fails multi-column and alternating layouts;
- numbering alone misses unnumbered front/back matter;
- body recurrence alone can mistake late indexes;
- source H2 collapses nearly all hierarchy.

## Sidecar streaming and `list_items`

The flat `content_list` is the smallest common layout evidence but existing code discards
`list_items` and parses the whole file. Use a maintained streaming JSON parser, cap bytes,
depth, records and text, and emit each list item with group order. A group without item bboxes
retains list order; it does not receive fabricated indentation.

Nested v2 sidecars remain a bounded fallback candidate only if flat evidence is absent; they
are not an editable authority.

## Region discovery

Candidate starts come from exact standalone labels, continuous/spaced leaders, right-side page
labels and early repeated title sequences. Reconstruct 1-3 columns before joining wrapped
rows. End at the last reliable row using density, local gaps and monotonic page labels; do not
use the prototype's label-page-plus-20 window.

Score boundary confidence separately from body matches. Frontmatter position plus later
monotonic body recurrence identifies contents; a late candidate or reverse/no recurrence is
penalized as an index. Multiple disjoint regions can be accepted, with one canonical source.

## Sparse global alignment

Build only plausible entry/heading edges from numbering and normalized-title similarity.
Dynamic programming includes match, skip-entry and skip-heading transitions and retains best
and second-best path scores. Accept each pair only above absolute and margin thresholds.
This preserves reliable later matches around missing rows and makes duplicate-title ambiguity
local instead of collapsing a normalized-title map.

## Hierarchy and split semantics

Semantic kinds resolve context before numeric depth: Part/篇/部分 is h1; its Chapters are h2;
their decimals shift accordingly. Without a Part, Chapter is h1. Appendix and standalone
backmatter reset h1. Close gaps and clamp at h4.

Splitting is independent: Part, later Chapter, Appendix and major front/back units start pages;
the first Chapter immediately after a Part does not double-split. Ordinary sections stay on
their parent page by default.

## OCR fallback

Native PDF text and MinerU sidecars are usually better and cheaper. OCR is therefore a worker
fallback only when they cannot establish a candidate. Use Poppler at 150 DPI and Tesseract
`eng+chi_sim`, only among the first 48 pages, 15 seconds per page and 10 minutes aggregate.
Absence, timeout or low confidence is diagnostic, not a content replacement. Isolated raster
directories are deleted on success, failure and cancellation.

## Acceptance separation

All fifteen references are an exact content-correctness gate. Performance remains a separate
suite using the established 441-page and 583-page books, one other representative real book,
the 500-page synthetic book and uncached reader p95. Conflating these sets would make local
correctness data a performance dependency and would weaken both signals.

There is no human adjudication layer in 007. Region discovery, canonical selection, body
alignment and hierarchy are production algorithm outputs. Codex image recognition creates the
independent offline oracle; diagnostics expose uncertainty but do not request a person to fill
an answer back into the analyzer.
