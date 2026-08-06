# Data Model: Body Heading Numbering

## Numbering Policy

```text
source | generated | none
```

- Stored at `book.yaml` v4 `publishing.numbering.mode` in every immutable config revision.
- Defaults to `source` during draft preparation.
- `source`: use each heading's optional `source_number` regardless of role.
- `generated`: compute a number only when derived role is `body`.
- `none`: set every compiled heading number to `null`.

Validation accepts exactly the existing three values. This feature adds no field and no schema migration.

## Heading Inputs

Each configured heading retains `block_id`, `title_markdown`, optional `source_number`, `display_level`,
TOC/page flags and optional alias. `frontmatter | body | appendix | backmatter` continues to derive from
the ordered body, appendix and backmatter boundary identities.

No mode transition changes heading inputs or authoritative Markdown.

## Compiled Heading Presentation

```text
source heading + configured title/level + derived role + numbering policy
  -> number: string | null
  -> title/titleChildren
  -> label: number and title combined once
```

Generated-body counters are positive and initially treat the first body heading's configured level as
numbering depth 1. Deeper headings are relative descendants. If a later body heading is shallower than that
base, it becomes the next depth-1 item and lowers the base for following headings, without reusing an earlier
top number. Skipped non-body roles never receive a number and never advance counters. The resulting immutable
presentation remains shared by rendered pages, TOC, outline, page metadata, manifest and search indexing.

## Draft State Transitions

```text
loaded(mode, etag)
  -> local mode change (dirty; server unchanged)
  -> PATCH with If-Match
  -> accepted config revision + building candidate
  -> ready candidate or bounded terminal failure
```

- Success refreshes the ETag and accepted mode while preserving edits made after submission.
- `412` preserves the local mode and other local changes for conflict recovery.
- Discard replaces local mode, boundaries and nodes with the newest authoritative draft.
- Candidate failure leaves the accepted config revision visible and the last published version immutable.

## Compatibility

The authoritative schema remains `book.yaml` v4; manifest v3 and version marker v3 remain unchanged.
Previously published versions are immutable. Rebuilding an existing draft applies the clarified D-122
generated semantics only to the new candidate.
