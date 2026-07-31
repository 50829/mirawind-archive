# Data Model

## `book.yaml` v4

- Metadata: title, authors, description, alias, optional cover asset.
- Source: Markdown hash, preprocessing provenance and ordered stable block identities.
- Boundaries: required body start; optional appendix and backmatter starts in source order.
- Structure: active headings only, with inline title Markdown, optional source number, level, TOC, page and alias.
- Numbering: `source | generated | none`, default `source`.

## Storage

- Source revisions are immutable and identify import/edit origin plus optional parent revision.
- Immutable assets hold source resources and covers; revision bindings map logical paths to assets.
- Access is `private | public`; draft/published lifecycle derives from `current_version_id`.
- Candidate and version transactions retain existing atomic and recovery semantics.
