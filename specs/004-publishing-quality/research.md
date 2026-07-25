# Research: Publishing Quality Closure

## Printed contents must be a source-region semantic, not a navigation flag

**Decision**: Represent a confirmed printed table of contents as a bounded
`reference_only` source region while retaining structure entries for every Markdown
heading.

**Rationale**: Current `include_in_toc` affects only manifest navigation. Printed headings
still participate in numbering, pages, outlines, body and search. Removing those headings
from `structure` would also make reversal difficult because the stable IDs would be lost.
A separately validated source region lets the active compiler filter complete root blocks
while the authoritative source and reversible heading identities remain intact.

**Alternatives considered**:

- Rewrite or delete the Markdown: rejected because Markdown is authoritative and false
  positives would be destructive.
- Set `include_in_toc: false`: rejected because it leaves all other derived contamination.
- Automatically discard every section named “目录”: rejected because ordinary chapters and
  local mini-contents can use that title.
- Persist a second extracted contents document: rejected as a competing editable authority.

## Use AST boundaries plus conservative textual evidence

**Decision**: Detect candidates from explicit contents headings and complete AST root-block
boundaries, then use chapter identifiers, trailing printed page labels and monotonic later
body matches. Require at least three unique ordered matches for an automatically applied
proposal.

**Rationale**: The representative MinerU sample emits printed chapter entries as headings
and subsection entries as paragraph lines. AST-only heading levels are therefore
insufficient, while line regex alone cannot define safe exclusion boundaries. Combined
evidence is deterministic, bounded and reviewable.

**Alternatives considered**:

- Fuzzy title similarity: rejected for silent suppression because repeated textbook labels
  are common.
- MinerU `content_list.json` as authority: rejected because output variants are unstable and
  Markdown remains authoritative.
- LLM classification: rejected because it is non-deterministic, network-dependent and
  unnecessary for explicit numbered contents.

## `book.yaml` v2 uses UTF-8 byte ranges, digests and title-free entry mappings

**Decision**: Record source path/hash, a half-open UTF-8 byte range and range SHA-256 plus
bounded entry byte ranges, reference levels and optional matched body block IDs. Regions
are sorted, non-overlapping, count-bounded and must align with complete top-level parsed
blocks. Entry titles, confidence and paper page labels remain derived preview data.

**Rationale**: UTF-8 byte offsets are portable and unambiguous across runtimes, unlike
JavaScript code-unit offsets or Unicode columns. Whole-source, region and entry digests
prevent silent reuse after source change. Persisting title-free mappings makes the accepted
one-to-one structure auditable without copying a second editable body into configuration.
Root-block alignment prevents partial headings, formulas, tables or footnotes from being
removed.

**Alternatives considered**:

- Parser character offsets or line/column pairs: rejected because offset/column units differ
  between runtimes and Unicode conversions can be ambiguous.
- Heading IDs only: rejected because a printed region also contains paragraph entries.
- Persisting extracted title text: rejected because structure already records accepted
  heading overrides and config must not become a second body.

## Preview and publication share configured-document preparation

**Decision**: Extract parsing/ID assignment, source-region validation/filtering, configured
heading validation, numbering and page splitting into one compiler seam. Both builders then
call the existing semantic renderer.

**Rationale**: Current preview uses a separate raw parsed-document renderer, ignores
configured heading semantics, emits one page and writes empty diagnostics. Reusing only the
final HTML renderer is insufficient unless the earlier structural stages are also shared.

**Alternatives considered**:

- Compare two independent renderers after the fact: rejected because parity would remain a
  perpetual synchronization obligation.
- Publish the exact preview files: rejected because preview and published resource URLs,
  permissions, shells and immutable identifiers differ.
- Render on preview HTTP requests: rejected by the request-path constitution.

## Chinese typography normalization is persisted import preprocessing

**Decision**: Add closed `preserve-v1 | zh-smart-v1` preprocessing provenance to
`book.yaml` v2. In the import worker, parse the selected Markdown to find eligible prose
slices, apply minimal replacements, and atomically persist the output as the authoritative
main Markdown before hashing, stable IDs and source-region analysis. New imports default to
`zh-smart-v1`; v1 migration records `preserve-v1`.

**Rationale**: A global text replacement would corrupt code, math, URLs, versions and other
technical tokens. AST context provides the protection boundary, while source-slice
replacement avoids an unrelated full-document serialization. A closed, deterministic rule
set can normalize Han/Latin and Han/digit spacing plus common Chinese punctuation while
remaining testable and idempotent. Persisting the output makes source ranges, preview,
publication, search and rebuilds use one body and keeps reader requests free of processing.

**Protected contexts**: Code, inline code, math, inline math, raw HTML, link destinations,
and URL/email/path/file/version/time/decimal/thousands/DOI/ISBN tokens. Visible link labels
remain eligible only when they are not themselves a technical token.

**Alternatives considered**:

- Transform only a derived AST or HTML: rejected because stored Markdown, range evidence,
  search and preview could disagree and rebuilds would depend on a hidden transform.
- Apply regexes to serialized HTML: rejected because escaping and tag boundaries make
  protected contexts unreliable and search would diverge from display.
- Always enable for old books: rejected because existing publication behavior must remain
  compatible until an administrator deliberately opts in and republishes.
- Broad language-model copy editing: rejected because it is not deterministic, bounded or
  a closed presentation rule.

## KaTeX duplication is missing and version-mismatched renderer assets

**Decision**: Pin one KaTeX 0.18.1 engine for markup and validation, keep the accessible
KaTeX DOM, and deterministically generate the exact minified stylesheet, 20 WOFF2 fonts,
license and integrity manifest under the renderer-versioned Astro `/_astro/` static path.

**Rationale**: The representative page contains equal `katex-mathml` and `katex-html`
nodes, as expected from KaTeX, but no CSS that visually hides the MathML representation.
The source Markdown contains only one formula. The dependency graph also currently lets
direct validation use 0.18.1 while `rehype-katex` renders with 0.16.47. Removing MathML
would harm accessibility; copying top-level CSS without unifying the renderer would still
violate markup/asset identity. Astro already copies public `/_astro/` files to the runtime
client closure with immutable caching, and Docker already copies the complete `dist`.

**Alternatives considered**:

- Remove MathML: rejected for accessibility.
- Add only `.katex-mathml { display:none }`: rejected as an incomplete KaTeX renderer.
- Use a CDN: rejected by self-hosting, privacy and deterministic rebuild requirements.
- Inline the full stylesheet and fonts into every page: rejected because it multiplies
  immutable page size across large books.
- Read fonts dynamically from `node_modules` on every request: rejected because a static
  build closure is easier to verify and keeps font traffic out of the application route.

## Version-one compatibility is read-old/write-new

**Decision**: Validate v1 and v2 strictly, treat v1 as no source regions, and migrate to v2
with typography provenance `preserve-v1` only when creating a new editable revision. Never
rewrite frozen v1 published files.

**Rationale**: Existing database rows already record the config schema version, so no
SQLite migration is necessary. Read-old/write-new preserves old versions and avoids a
startup rewrite while ensuring all new proposals are portable.

**Alternatives considered**:

- Modify the v1 schema in place: rejected because unknown-field strictness makes that a
  silent format change.
- Eagerly rewrite every draft and version: rejected because published directories are
  immutable and bulk failure recovery would be unnecessary.
