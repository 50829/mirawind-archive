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

- Isolated updated Web and worker: `http://127.0.0.1:4322`; the existing preview on 4321 was not
  stopped or reused.
- In-app Browser desktop: public library, route-driven details, Reader page 1/page 2 navigation,
  hierarchical TOC/page outline, administrator login, import page, task/recovery list, book 6
  publishing workbench and generated preview iframe all rendered and interacted successfully.
- In-app Browser visual/network indicators: 1280x720 library/Reader/workbench screenshots were
  nonblank; required styles loaded; broken image count 0; document width stayed within viewport;
  console warning/error logs remained empty.
- In-app Browser responsive: 390x844 library, workbench/preview and Reader had no horizontal overflow,
  blank view, clipped primary control or open-dialog overlap. Mobile Reader exposed directory, page
  outline, search and download controls; mobile workbench exposed preview/structure switching.
- The Browser client blocked direct top-level navigation to the private health JSON endpoint with its
  own client policy. The authenticated `/manage/tasks` UI loaded worker-produced maintenance,
  verification, build, interruption, cancellation and retry states without console errors.
- Chrome plugin: unavailable. The supplied Chrome Web Store screenshot shows the extension item is
  not available; the user accepted the in-app Browser plugin as the final interactive surface.
- Browser follow-up found 35 full task cards rendered by default (`10,522 px` document height) even
  with no active job. The fixed page always shows active and failed/interrupted/canceled work, limits
  recent successful history to 8, and provides an explicit expand/collapse control.
- Fixed task-page Browser evidence: 3 actionable + 8 recent cards by default, 11 cards and `3,798 px`
  height; expand produced all 35 cards and `10,686 px`, collapse restored 11. At 390x844 there was no
  horizontal overflow or clipped button and console warning/error logs remained empty.
- Additional Browser interactions passed: mobile workbench preview/structure switching, structure
  item dialog selection (`方法`, H1), preview restoration, Reader TOC drawer, book search with 3
  visible results, and result navigation to page 2 with the expected fragment.

## Final Gates

- `pnpm format`: passed.
- `pnpm lint`: passed; canonical imports 0 replacements, dependency graph 286 files/0 diagnostics,
  semantic names 0 diagnostics, ESLint/style tokens passed.
- `pnpm typecheck`: 459 files, 0 errors, 0 warnings, 0 hints.
- `pnpm test`: 124 files, 716 tests passed.
- `pnpm build`: Astro server plus CLI/worker/child production bundles passed.
- `MIRAWIND_E2E_PORT=4322 pnpm test:e2e`: 23 passed, 3 conditional skips.
- Current-source reference generation: 15 registered MinerU fixtures regenerated under ignored
  `.cache/014-reference-OTVDb2`; strict comparison returned `15/15` exact with zero issues.
- Reference performance set: 3 designated real fixtures plus the 500-page synthetic stress fixture
  all PASS. Worst idle read p95 `18.511 ms`, concurrent-build read p95 `34.033 ms`, normal search p95
  `47.578 ms`, short search p95 `56.397 ms`; all are below 300/1,000 ms gates. Wall/RSS remained
  within the accepted baseline tolerances. Sanitized report SHA-256:
  `323795ed7f36973515a78b26fcb63f69531b70ff579149b1c8c92ce5bcbd6b2e`.
- Final Spec Kit analyze: 27/27 buildable requirements covered, 0 CRITICAL, 0 unresolved
  clarification, 0 constitution conflict.
- Converge: no missing, contradictory or unrequested code work and no new task appended. The one
  external Chrome limitation was superseded by the user's accepted Browser-plugin verification.
- Browser follow-up E2E: responsive management hierarchy/history limit and worker recovery/health
  refresh both passed (`2/2`).
