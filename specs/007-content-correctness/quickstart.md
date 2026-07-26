# Quickstart: Validate Content Correctness

## Strict reference v2

```sh
pnpm fixtures:verify-real -- --dir "$PWD/tests/fixtures/mineru/real"
pnpm fixtures:reference-pack -- --fixture real-mineru-example
pnpm fixtures:compare-references -- --dir "$PWD/tests/fixtures/mineru/real"
```

The pack command emits observations only. A reviewer completes each ignored
`references-v2/<fixture-id>.json` after inspecting every listed PDF page. The compare command
fails unless all fifteen registered books have valid v2 files and every expected decision
matches. v1 and unknown schemas are rejected.

## Focused gates

```sh
pnpm vitest run --project unit tests/unit/fixtures/mineru-reference-v2.test.ts
pnpm vitest run --project unit tests/unit/compiler/layout-evidence.test.ts
pnpm vitest run --project unit tests/unit/compiler/printed-toc.test.ts
pnpm vitest run --project unit tests/unit/compiler/structure-proposal.test.ts
pnpm vitest run --project unit tests/unit/compiler/typography.test.ts
pnpm vitest run --project integration tests/integration/recovery/prepare-preview.test.ts
```

## Performance and repository gates

```sh
pnpm benchmark:build
pnpm benchmark:read
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The build benchmark uses three designated real books plus the 500-page synthetic book. The
reader benchmark retains the 300 ms uncached p95 target. Neither substitutes for the
fifteen-book exact correctness comparison.
