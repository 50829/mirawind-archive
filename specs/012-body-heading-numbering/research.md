# Research: Body Heading Numbering

## Decision 1: Use the existing three-state publication policy

- **Decision**: Expose `source | generated | none` as 原书编号 / 自动编号 / 无编号.
- **Rationale**: `book.yaml` v4 and the compiler already model these as reversible presentation choices.
  Markdown, source-number evidence and published versions remain untouched.
- **Rejected**: Destructive add/remove commands, separate TOC/body switches, CSS counters and client-only
  numbering. They either lose source data or create multiple numbering authorities.

## Decision 2: Generated numbering applies only to `body`

- **Decision**: `frontmatter`, `appendix` and `backmatter` receive `null` generated numbers; body starts at
  `1` even when its first configured heading is H2-H4.
- **Rationale**: D-122 records the user's explicit “只用编号正文” requirement. Role derives from the
  existing ordered boundaries, so no per-heading flag or schema change is needed.
- **Rejected**: Generated appendix letters and rejection of body sections that start below H1. The first
  contradicts the requirement; the second rejects valid globally continuous structures.

## Decision 3: Compile once in the worker

- **Decision**: Keep the shared heading presentation as the only number/title/label authority used by page
  HTML, TOC, outline, breadcrumbs/page metadata, manifest and search.
- **Rationale**: Pandoc, Docutils, Sphinx and LaTeX all treat numbering as derived output state. Sphinx in
  particular propagates one section-number calculation to navigation and rewrite decisions. This matches
  Mirawind's immutable candidate architecture.
- **Rejected**: CSS counters and independent consumer transforms. CSS cannot populate server manifests or
  search, and duplicated transforms can drift.

## Decision 4: Prefer conservative source-prefix evidence

- **Decision**: A decimal adjacent directly to title text is not split as a number. Rich Markdown prefixes
  are removed from raw title Markdown only when the same visible prefix was confidently recognized. The
  parsed inline tree and its source positions locate the title boundary; delimiter-specific regular
  expressions are not a second Markdown parser.
- **Rationale**: `8.5英寸软盘` is legitimate title content, while `**4.4.4** Virtual memory` must not emit
  `4.4.4` twice. Low-confidence input stays intact and remains manually correctable.
- **Rejected**: Broader regular expressions during mode switching. They could irreversibly misclassify
  technical titles and violate reversibility.

## Primary Sources

- WHATWG HTML defines `h1`-`h6` as semantic levels, not publication numbers:
  <https://github.com/whatwg/html/blob/24c5e48bf66ea61bc199ec6338c81258275ba9c6/source#L20187-L20195>
- CommonMark defines heading markers and inline content without a chapter-number field:
  <https://github.com/commonmark/commonmark-spec/blob/9103e341a973013013bb1a80e13567007c5cef6f/spec.txt#L1096-L1108>
- Pandoc `--number-sections` applies numbering at output time:
  <https://github.com/jgm/pandoc/blob/d6011e4465d4cb0d0a6fb872dab3ed089f404a75/MANUAL.txt#L1211-L1230>
- Docutils inserts generated section numbers before contents processing:
  <https://github.com/docutils/docutils/blob/74f8d2c9d350f9e5875b43b5e20f134c7118b690/docutils/docutils/transforms/parts.py#L18-L67>
- Sphinx calculates and shares section-number tuples from the document tree:
  <https://github.com/sphinx-doc/sphinx/blob/cc7c6f435ad37bb12264f8118c8461b230e6830c/sphinx/environment/collectors/toctree.py#L197-L283>
- CSS Lists counters are presentation-tree counters rather than a publication data model:
  <https://github.com/w3c/csswg-drafts/blob/13b14ec48af0219c893713d670cf80d8c014a648/css-lists-3/Overview.bs#L740-L774>

The full network investigation and alternatives are retained in
[`docs/research/heading-numbering-auto-toggle-2026-08-02.md`](../../docs/research/heading-numbering-auto-toggle-2026-08-02.md).
