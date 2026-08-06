# Quickstart: Body Heading Numbering

## Automated Validation

```bash
pnpm vitest run tests/unit/compiler/structure-proposal.test.ts
pnpm vitest run tests/integration/compiler/pages-manifest.test.ts
pnpm vitest run tests/integration/publication/config-revisions.test.ts
pnpm vitest run tests/unit/library/structure-editor-state.test.ts
pnpm test:contract
pnpm typecheck
pnpm lint
pnpm build
```

## Manual Workflow

1. Start the Astro web process and worker against a local test library.
2. Open an authenticated book publishing workbench.
3. Select 自动编号 and save. Confirm a candidate rebuild starts.
4. In the ready preview, verify正文 labels start at `1` while 前言, 附录 and 后记 have no number.
5. Check the page body, TOC, outline, breadcrumb/page title and search for the same labels.
6. Select 无编号, save and confirm every heading number disappears.
7. Select 原书编号, save and confirm imported source numbers return unchanged.
8. Create a stale-tab save conflict and verify the local selection and unrelated edits remain recoverable.

## Completion Gate

Format, lint/architecture, typecheck, full Vitest, focused Playwright and production build must pass. Spec
Kit analyze must have no unmitigated CRITICAL finding, and converge must append no unbuilt task.

## Closure Evidence

- Focused compiler, parser, config, editor-state and contract tests: 5 files, 81 tests passed.
- Full Vitest: 117 files, 669 tests passed.
- Full publishing workbench Playwright: 9 tests passed, including 320-1440 px, 200% text, accessibility,
  20,000-heading virtualization, numbering save and ETag conflict retention.
- Typecheck: 425 files, 0 diagnostics. Lint, architecture, style-token and production-build gates passed.
- Idle uncached reading benchmark: 200 requests at concurrency 8 after 20 warmups; p95 9.418 ms against the
  300 ms target. Numbering remains worker-owned, so no reader-request work was added.
