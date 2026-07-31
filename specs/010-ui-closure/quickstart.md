# Quickstart

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test:unit -- tests/unit/library
pnpm test:integration -- tests/integration/library tests/integration/http
pnpm test:integration -- tests/integration/storage/multipart-import.test.ts
pnpm test:contract -- tests/contract/library-reading.contract.test.ts tests/contract/import-preview.contract.test.ts
pnpm build
pnpm test:e2e -- tests/e2e/library-reading.spec.ts tests/e2e/import-upload.spec.ts tests/e2e/worker-recovery.spec.ts
```

In Playwright, check 320/360/768/1024/1440 widths, 200% text, keyboard/focus restoration,
ReaderShell headings, full-screen mobile details, the 16-row TOC cap, shared management
navigation, anonymous zero-`4xx` behavior, and identical public HTML/ETag across session state.
For management imports, also check one filename presentation, continuous accepted-upload state,
determinate/indeterminate progress, human-readable task subjects, and secondary internal IDs.
