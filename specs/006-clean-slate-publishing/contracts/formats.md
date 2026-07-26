# Format Contracts

| Format                   | Current schema | Authority                             |
| ------------------------ | -------------: | ------------------------------------- |
| `book.yaml`              |              3 | Portable publishing configuration     |
| `document-manifest.json` |              2 | Rebuildable semantic/version manifest |
| `version.json`           |              2 | Complete immutable version marker     |

All formats reject unknown fields and unsupported schema versions. `book.yaml` v3 includes
the typography provenance, explicit source-region `applied` state and stable block-based
structure used by the workbench PATCH contract.

Generated identities are fixed by the current source constants. Preview and publication
must capture the same compiler and renderer identities for the same source/configuration.
