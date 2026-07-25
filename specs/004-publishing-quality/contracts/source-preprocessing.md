# Contract: Persisted source preprocessing

## Pipeline boundary and storage

The same-codebase worker performs preprocessing in this order:

1. stream and validate the hostile import using the existing archive limits;
2. select the candidate main Markdown and retain the immutable uploaded original;
3. apply the selected typography profile to a staging copy;
4. atomically persist the resulting bytes as the new source snapshot's
   `source.main_markdown`;
5. calculate the accepted Markdown digest, assign stable block IDs, detect printed
   contents and write `book.yaml`;
6. register the source/configuration revision and queue its preview.

The staged input is never a reader-visible or editable second body. Preview, publication,
search and rebuilds read the persisted normalized Markdown. Reader and preview HTTP requests
never execute preprocessing.

## Profiles and bounded provenance

`preserve-v1` is an identity transform. `zh-smart-v1` records:

- input and output SHA-256;
- `spaces_normalized`, `punctuation_converted` and `protected_nodes`, each an integer from
  zero through 2,147,483,647;
- no source excerpt or per-token diagnostic.

The output SHA-256 must equal `source.main_markdown_sha256`. A v1 migration records
`preserve-v1`, equal input/output digests and zero counters.

## `zh-smart-v1` algorithm

The implementation parses Markdown to obtain protected node and eligible text positions,
then applies sorted, non-overlapping replacements to the original UTF-8 source. It does not
serialize the complete AST.

### Eligible visible text

Text in headings, paragraphs, emphasis, strong text, strikethrough, list items, block
quotes, table cells, footnotes, captions and non-technical link labels is eligible. Inline
formatting and non-technical link labels are transparent when evaluating adjacent visible
characters, so a displayed Han/Latin boundary split by formatting receives the same
spacing as a boundary in one text node.

Code blocks, inline code, math, inline math, raw HTML, autolinks and every link/image
destination are opaque. The algorithm neither edits their bytes nor infers spacing through
them. Image alternative/title text is preserved in v1 because changing it would require
destination-aware Markdown serialization.

### Protected technical tokens

Within otherwise eligible text, preserve the bytes of complete tokens recognized as:

- URI/URL or `www.` address;
- email address;
- absolute or relative POSIX/Windows path;
- file name with an extension;
- semantic/version-like number with at least two numeric components;
- `HH:MM` or `HH:MM:SS` time;
- decimal or thousands-separated number;
- DOI or ISBN-10/ISBN-13, including standard hyphenated ISBN notation.

Spacing may be inserted between a complete protected token and an adjacent Han character,
but token-internal bytes never change.

### Mixed-script spacing

Han means Unicode `Script=Han`; Latin means Unicode `Script=Latin`; digit means ASCII
`0`–`9`.

For adjacent visible Han/Latin, Latin/Han, Han/digit and digit/Han pairs separated only by
horizontal Unicode whitespace, write exactly one U+0020. Never consume or insert across an
explicit line break. Apply the same rule across transparent inline-formatting boundaries,
placing the space outside the Markdown delimiter.

### Chinese punctuation

In one eligible inline prose run:

- convert `, ; : ? !` when the nearest non-horizontal-space character on either side is
  Han or Chinese punctuation;
- convert `.` when the preceding visible character is Han or Chinese closing punctuation
  and the following character is Han, a line/end boundary or closing punctuation; decimal,
  version, file and ellipsis tokens take precedence;
- convert exactly three ASCII periods to `……` when either visible neighbor is Han or
  Chinese punctuation and the run is not part of a longer period sequence;
- match ASCII parentheses with balanced nesting and ASCII double quotes in pairs; convert
  both marks only when their enclosed visible text contains Han or an immediate outside
  visible neighbor is Han;
- leave unmatched or ambiguous pairs unchanged;
- remove horizontal whitespace immediately before `，。；：？！）》」』】` and immediately
  after `（《“‘「『【`, including the inner edge of newly converted pairs; in Chinese
  context also remove horizontal whitespace between Chinese punctuation/closing marks and
  a following Han character or opening mark.

The algorithm does not perform grammar correction, word segmentation, quote inference
across blocks, traditional/simplified conversion or any punctuation conversion outside
these rules.

## Idempotency and atomic failure

Running a profile against its own output must produce byte-identical output and zero new
conversions. On parse, limit, write, digest, schema or registration failure, staging is
cleaned and the current draft source, ready preview and published version remain unchanged.

## Explicit re-preprocess route

`POST /api/manage/books/:bookId/reprocess`

The route requires administrator authentication, returns `private, no-store`, prohibits
indexing and accepts:

```json
{
  "profile": "zh-smart-v1",
  "original_file_id": "file_opaque",
  "expected_source_id": "src_opaque",
  "expected_config_revision": 4
}
```

The original file must belong to the captured source and be a supported re-import input.
The expected source and revision are strong concurrency preconditions. A current request
returns `202` with an opaque job ID. A stale request returns
`409 REPROCESS_PRECONDITION_FAILED`; an unavailable original returns
`409 REPROCESS_SOURCE_UNAVAILABLE`.

The worker builds a new source snapshot and next configuration revision in staging. One
database transaction registers them, updates the draft pointers and clears the old
ready-preview pointer; then preview is queued. It never changes `current_version_id`.
Retries are idempotent for the same job, and failed/cancelled jobs expose bounded
diagnostics without changing any pointer.
