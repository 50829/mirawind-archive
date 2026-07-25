# Data Model: Publishing Quality Closure

## Confirmed source region

Portable `book.yaml` v2 configuration for a source range that is retained in Markdown but
excluded from selected derived representations.

| Field | Rules |
| --- | --- |
| `region_id` | Required opaque `region_` identifier; unique within a book configuration |
| `kind` | `printed_toc` in this feature |
| `disposition` | `reference_only` in this feature |
| `source_path` | Must equal `source.main_markdown` |
| `source_sha256` | Must equal `source.main_markdown_sha256` |
| `range.start_byte` | Zero-based first included UTF-8 byte |
| `range.end_byte` | Exclusive UTF-8 byte; greater than `start_byte` |
| `range.sha256` | SHA-256 of the exact range bytes |
| `entries` | Title-free entry ranges, reference levels and optional body targets |

The top-level `source_regions` array is required in v2, contains at most 32 regions, is
ordered by source location and cannot overlap. Entries across the book are capped at
20,000. Each range must align to complete root blocks. Entry ranges are contained, hashed
and non-overlapping; matched body targets are outside the region, unique and monotonic.

## Printed contents candidate

Disposable analysis output; never an editable authority.

| Field | Rules |
| --- | --- |
| candidate source bounds | Complete root blocks only |
| confidence | `high`, `medium` or `low` |
| entry count | Bounded count of recognized printed entries |
| matched count | Unique monotonic later body matches |
| conflicts | Bounded safe diagnostic codes and locations |
| proposed region | Present only when bounds and digest are valid |
| proposed heading changes | Target block ID plus proposed level/role/page-start |

Only a high-confidence candidate with at least three unique monotonic matches may be applied
to the initial draft automatically. Candidate details can be recomputed from Markdown and
are not persisted in published versions except as bounded build diagnostics.

## Structure node

Existing portable heading configuration remains in Markdown source order for every source
heading, including headings inside a reference-only region.

| Field | Behavior after v2 |
| --- | --- |
| `block_id` | Stable opaque heading identity; retained even inside excluded regions |
| `include_in_toc` | Ordinary navigation visibility only |
| `display_level` | Applied only when the heading is active |
| `display_title` | Optional display override; never rewrites source |
| `role` | Begins an inherited active content role at display level one |
| `starts_page` | Applied only when the heading is active |

Validation first binds all structure nodes to all source headings. Source-region filtering
then derives active headings; continuity, role inheritance, numbering, pages, outline,
manifest and search validate against that active sequence.

## Config schema states

```text
valid v1 ──read──> legacy configured document (no source regions)
   │
   └─edit/save──> deterministic v2 revision with source_regions: []
                  and source.preprocessing.typography.profile: preserve-v1

new import ──preprocess zh-smart-v1──> persisted authoritative main Markdown
          └─analysis───────────────> v2 revision with preprocessing provenance
                                     and zero or one high-confidence printed_toc region

valid v2 ──edit──> next immutable v2 config revision
```

Unsupported newer versions are rejected. Malformed v1/v2 configurations are rejected.
Published configuration files never transition in place.

## Configured semantic document

Derived in memory during worker compilation.

| Component | Source |
| --- | --- |
| full normalized document | Persisted post-preprocessing main Markdown plus stable heading IDs |
| validated regions | v2 region configuration plus Markdown and range hashes |
| excluded root block IDs | Complete blocks contained by reference-only ranges |
| active document | Full normalized document minus excluded root blocks |
| active headings | Configured headings outside excluded regions |
| numbered headings | Active headings plus inherited roles and numbering |
| pages | Active document split only at configured active headings |
| diagnostics | Region, structure, resources, math and code diagnostics |
| semantic digest | Canonical identity excluding authorization-specific URLs/shells |

Printed-contents matching, byte-range validation, stable heading identity, numbering,
pages, visible-text fingerprints, rendering and search all use the same persisted
post-preprocessing main Markdown.

## Typography preprocessing provenance

`source.preprocessing.typography` is required in schema v2:

| Field | Behavior |
| --- | --- |
| `profile` | `preserve-v1` or `zh-smart-v1` |
| `input_sha256` | Digest of the selected Markdown before preprocessing |
| `output_sha256` | Equals `source.main_markdown_sha256` |
| `spaces_normalized` | Bounded non-negative aggregate |
| `punctuation_converted` | Bounded non-negative aggregate |
| `protected_nodes` | Bounded non-negative aggregate |

`zh-smart-v1` parses the selected Markdown to identify eligible source text slices, then
applies minimal non-overlapping UTF-8 replacements and atomically stores the output as the
main Markdown. Code, math, raw HTML, destinations and recognized technical tokens are
protected. The original uploaded file remains an immutable `original_files` resource;
temporary extracted Markdown is not another editable authority.

## Preview artifact

Private, rebuildable, configuration-revision-specific output.

| Field | Rules |
| --- | --- |
| source ID and Markdown SHA-256 | Must match captured snapshot |
| config revision and YAML SHA-256 | Must match the ready draft revision |
| compiler/renderer identities | Must match the current publish compiler |
| semantic digest | Canonical digest of pages/headings/diagnostic codes |
| pages | One generated fragment per semantic page |
| source-region summaries | Bounded display data and conflict codes |
| typography provenance | Profile, input/output digests and aggregate counts |
| diagnostics | Structured, bounded and safe for administrator display |

Ready preview is publishable only while every captured identity remains current.

## Renderer asset

Public application asset, not a book resource.

| Field | Rules |
| --- | --- |
| renderer identity | `semantic-html-v3-katex-0.18.1` |
| asset path | Generated exact closure below the versioned Astro `/_astro/` path |
| media type | `text/css; charset=utf-8` or `font/woff2` |
| ETag | Strong content digest |
| cache | Public immutable one-year |
| authorization | None; bytes contain no book or user data |
| indexing | Application asset only; absent from navigation and book search |

## Invariants

- Reference-only content remains byte-for-byte present in authoritative Markdown and frozen
  version source.
- No active page, manifest block, formal TOC, search row or presentation projection refers
  to an excluded block.
- Removing a source-region configuration reactivates the original headings with their
  existing structure IDs.
- Preview and publication from equal captured inputs have equal active headings, pages,
  persisted prose, typography provenance, numbering, diagnostic codes and semantic digest.
- Applying `zh-smart-v1` twice is byte-identical to applying it once; `preserve-v1` is the
  identity transform.
- Preprocessing completes before a source snapshot becomes ready; no HTTP reader or preview
  request and no publication rebuild rewrites that source.
- Renderer assets do not vary by book, user, cookie or visibility.
