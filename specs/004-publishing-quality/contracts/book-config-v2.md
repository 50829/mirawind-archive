# Contract: `book.yaml` v2 source regions

## Version behavior

- Schema v1 remains strict and readable.
- Schema v2 is the write format for new imports and edited drafts.
- A v1-to-v2 migration changes only `schema_version` to `2` and adds
  `source_regions: []` plus `source.preprocessing.typography` with profile `preserve-v1`,
  identical input/output Markdown digests and zero counts; all other JSON data remains
  equal.
- A new import preprocesses and persists the main Markdown before writing provenance with
  profile `zh-smart-v1`.
- Unknown versions and unknown fields are rejected.

## v2 addition

```yaml
schema_version: 2
source:
  main_markdown: source/full.md
  main_markdown_sha256: dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
  original_files: []
  preprocessing:
    typography:
      profile: zh-smart-v1
      input_sha256: eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
      output_sha256: dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
      spaces_normalized: 128
      punctuation_converted: 42
      protected_nodes: 17
source_regions:
  - region_id: region_4L8WfX5E0cVnJp2Q
    kind: printed_toc
    disposition: reference_only
    source_path: source/full.md
    source_sha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    range:
      start_byte: 4096
      end_byte: 16384
      sha256: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
    entries:
      - range:
          start_byte: 4172
          end_byte: 4201
          sha256: cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
        reference_level: 1
        body_heading_block_id: blk_4L8WfX5E0cVnJp2Q
```

`source_regions` is required and may be empty. It contains at most 32 objects, with at most
20,000 entries across the book. Regions and entries use half-open zero-based UTF-8 byte
ranges. Regions must be ordered and non-overlapping. Each ID is opaque and unique.
Confidence, printed page labels and extracted title text are derived preview data and do not
enter authoritative configuration.

`source.preprocessing.typography` is required in v2, rejects unknown fields, and records
exactly one applied profile: `preserve-v1` or `zh-smart-v1`. Its output digest must equal
`source.main_markdown_sha256`; counts are integers from zero through 2,147,483,647. It is
provenance for already persisted Markdown, not a render-time switch.

## Semantic validation

- The complete Markdown digest must match `source.main_markdown_sha256`.
- Region source path/hash, range digest and entry digests must match that Markdown.
- A region begins and ends between complete document-root blocks; it cannot split a
  paragraph, table, formula, list, HTML block, footnote or semantic container.
- Regions cannot overlap; entries must be contained and non-overlapping.
- Matched body heading IDs must be outside the region, unique and ordered monotonically.
- `structure` continues to contain one node for every Markdown heading, including headings
  inside regions.
- Active heading level continuity and role validation ignore headings contained by a
  `reference_only` region.
- A reference-only region cannot remove a definition or footnote that remains referenced by
  active content.
- Typography completes before source-region detection and all region ranges/digests bind
  the persisted output. Technical tokens and AST nodes defined by D-104 remain protected,
  non-target bytes remain unchanged, and a second normalization pass must be identical.

## Failure behavior

Every invalid region or entry mapping rejects preview and publication. Validation errors
expose a bounded configuration path and safe code, never the complete source slice.
