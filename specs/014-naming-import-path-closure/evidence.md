# Evidence: Naming, Import, and Path Closure

## Baseline

- Baseline commit: `4dacb24` (`refactor(architecture): close module and worker boundaries`)
- Product source inventory: 285 TypeScript/TSX/Astro/JavaScript/CSS files under `src/`
- Direct import/export lines using `@/`: 208 product files
- Product files using relative first-party import/export lines: 0
- Context-dependent files in scope: four `application/public.ts` facades,
  `composition/worker-child/types.ts`, and `platform/filesystem/layout.ts`
- Historical runtime identifiers: `PrintedContentsAnalysisV2` plus create/parse callers in product
  source; `MineruReferenceV2` plus author/parse/read/compare callers in offline fixture tooling
- Approved version literal exception already present: MinerU vendor `_content_list_v2` filename match
- Obsolete runtime branch: `legacyNativeRecords()` accepts plain form-feed text although the current
  command always requests `pdftotext -tsv`
- Path audit findings: storage roots are lexical rather than canonical; internal relative paths accept
  dot/repeated components; archive registry lacks case-fold/control/drive-relative checks and uses a
  descendant scan; extraction compares only entry count and directory flag across ZIP passes; atomic
  write failure can leave its temporary sibling.

## Specification Analysis

- Initial analysis: 27/27 buildable requirements covered by tasks; zero CRITICAL findings.
- Remediated before implementation: added `src-root`, reserved `@/schemas/*`, and explicit tests/scripts
  support-code scope to the spec, plan, research, contract and tasks.

## Implementation Evidence

- Product source after semantic splits: 286 files.
- Canonical import inventory: 373 package-local relative specifiers and 592 cross-package or
  authoritative-data `@/` specifiers; `architecture:imports` reports 0 files/0 replacements.
- Named module APIs: `catalog-api.ts`, `identity-api.ts`, `publishing-api.ts` and `reader-api.ts`;
  worker child contract: `job-handler.ts`; no old forwarding file remains.
- Current runtime names: `PrintedContentsAnalysis` and `MineruReference` APIs; persisted
  `printed-contents-analysis-v2`, schema version 2 reference data, compiler/renderer/profile values and
  MinerU `_content_list_v2` vendor discovery remain unchanged.
- Removed runtime branch: plain form-feed native PDF evidence is no longer accepted when
  `pdftotext -tsv` returns malformed output; current bounded OCR/diagnostic policy applies.
- Filesystem split: `storage-layout.ts`, `contained-path.ts` and `atomic-file.ts`; deleted
  `platform/filesystem/layout.ts` without a forwarding export.
- Archive hardening: drive-relative and control names reject; NFC/NFKC case-fold collisions reject;
  prefix checks are bounded; the complete inspected entry identity is compared before second-pass
  target creation.
- Storage hardening: canonical non-symlink roots and managed directories, canonical internal paths,
  failed atomic-write cleanup, canonical parent verification for reads/removals, safe recovery
  directory creation and quarantine inspection.
- Additional audit finding fixed: a symlinked intermediate cleanup parent could previously delete a
  leaf outside the declared root even though the leaf itself was not a symlink.
- Residual boundary: a privileged or same-UID attacker continuously replacing a directory after its
  canonical check remains outside the approved single-owner host threat model; descriptor-relative
  `openat2` would require a separately approved native boundary.
- Focused evidence after implementation: 21 architecture tests, 47 current parser/reference/render
  unit tests and 85 archive/storage/publication/recovery integration tests passed (153 total).
- Static evidence: `pnpm lint` passed with zero dependency/name/style diagnostics; `pnpm typecheck`
  checked 458 files with 0 errors, warnings or hints.

## Browser Evidence

Pending.

## Final Gates

Pending.
