# Compiler Evidence Contract

## Layout input

`readMineruLayoutEvidence(markdownPath, signal)` reads only regular, same-directory companions
selected by the accepted archive manifest. It streams the flat JSON and enforces configured
byte, nesting, record, page, bbox and text limits before retaining values.

```ts
interface LayoutEvidence {
  readonly records: readonly LayoutEvidenceRecord[];
  readonly diagnostics: readonly EvidenceDiagnostic[];
  readonly source: "content-list" | "native-pdf" | "ocr" | "none";
}
```

Each `list_items` value becomes an ordered record with a shared group ID. Missing item bboxes
retain item order and do not inherit or invent horizontal coordinates. Malformed records are
skipped with diagnostics. Oversize, malformed, unsafe or canceled inputs never mutate accepted
Markdown or leave partial analysis.

## Printed contents

`detectPrintedContents` returns all disjoint candidate regions and a canonical candidate ID.
Each region exposes boundary confidence separately from its entry match states. Accepted
regions use `reference_only`; only the canonical region contributes hierarchy.

Region acceptance, canonical selection, body alignment and hierarchy are deterministic
production outputs. No confirmation record, publishing override or reference fixture is an
input to these decisions.

The detector recognizes labelled and unlabelled early runs, spaced/continuous leaders,
ordinary right-side page suffixes, 1-3 columns and wrapped rows. A reliable intervening row can
bridge noise. Termination follows the last reliable row, not a fixed page count. Late index
candidates are rejected using position and direction of body recurrence.

## Alignment

The alignment result contains ordered per-entry states, best score, second-best score and
margin. Candidate pairs preserve duplicate occurrences. Number/title normalization is
comparison-only; visible source text and root-block hashes are unchanged.

## Analysis artifact

Preparation writes a strict private `printed-contents-analysis-v2` artifact pinned to source
and config revision. Preview may project bounded diagnostics and locations from it. Publication
and reader assets cannot reference or serve it.
