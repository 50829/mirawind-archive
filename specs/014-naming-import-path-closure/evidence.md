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

Pending.

## Browser Evidence

Pending.

## Final Gates

Pending.
