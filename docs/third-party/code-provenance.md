# External Code Provenance

This ledger implements D-090. Add an entry before merging any substantive copy or
adaptation of external code. A package used only as a normal dependency belongs in the
lockfile and license audit, not in this table.

Behavior-only research that contributed no copied or adapted code stays in the relevant
research document. The current survey is
`docs/research/existing-implementations-and-commit-conventions.md`.

## Required record

| Local path                                                     | Upstream repository | Immutable revision | Upstream path | License | Use | Local changes | Notices |
| -------------------------------------------------------------- | ------------------- | ------------------ | ------------- | ------- | --- | ------------- | ------- |
| _No substantive external code has been copied or adapted yet._ | —                   | —                  | —             | —       | —   | —             | —       |

For each real entry:

- link or name the governing decision or task;
- use a tag plus commit hash, or a full commit hash when no immutable tag exists;
- record the exact upstream file or directory path;
- distinguish copied, translated, and structurally adapted code;
- describe security-relevant deviations and retained tests;
- retain copyright and NOTICE text wherever the license requires it.

An entry in this ledger documents provenance; it does not by itself approve an
incompatible license.
