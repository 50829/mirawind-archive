# M1 documentation and provenance consistency report

- Reviewed: 2026-07-25
- Scope: T147, T151 and T152, plus the D-098 operational follow-up
- Result: **PASSED**

## Authority consistency

The constitution, D-001 through D-098, the product specification, feature specifications,
plan, contracts, tasks, architecture, operations guidance and implementation were compared.
No unresolved product-decision conflict was found.

The review corrected lower-authority documentation that had lagged behind already approved
and implemented behavior:

- architecture status and governing-decision range now include M1 completion and D-095;
- the architecture and plan now place job staging at `data/staging/<job_id>`, matching the
  runtime and same-filesystem publication protocol;
- operations guidance now uses the implemented `draft/source/<source_id>` path;
- the early User Story 3 report now points to the later real MinerU 3.4.4 acceptance evidence;
- performance guidance now records that all registered real fixtures and the stress
  fixture passed.
- D-097, the product specification, NFR-006, the plan, fixture guidance and story evidence
  now use the accepted 583-page and 441-page real representatives, 97-page real
  compatibility and 500-page synthetic stress combination;
- the feature specification and plan now report the implemented-and-verified lifecycle
  state instead of a future planning or handoff state.
- D-098 is synchronized into the product specification, architecture, local-preview
  feature, launcher contract, operations guidance and executable container contract. The
  local override retains separate Web/worker processes and does not alter production
  Compose or Caddy behavior.

These are documentation corrections, not changes to approved behavior. No implementation
continued across an unresolved authority conflict.

## External code and licenses

`docs/third-party/code-provenance.md`, the existing-project research, repository source,
dependency manifests and contribution guidance were checked together.

- No substantive external application code was copied, translated or structurally adapted.
- Surveyed projects remained behavior and test-pattern references.
- Normal dependencies are pinned in `package.json` and `pnpm-lock.yaml`.
- `pnpm licenses list --json` and `pnpm licenses list --prod --json` completed successfully.
- Production transitive copyleft artifacts are unmodified package artifacts: Sharp's
  libvips binary under LGPL-3.0-or-later and Lightning CSS modules/binaries under MPL-2.0.
  They are dependencies, not source ports, and therefore do not create provenance-ledger
  rows under D-090.

The provenance ledger remains intentionally empty and retains the required fields for any
future substantive port.
