# Quickstart: Validate Content Correctness

## Strict reference v2

```sh
pnpm fixtures:verify-real --dir "$PWD/tests/fixtures/mineru/real"
pnpm fixtures:reference-pack --fixture real-mineru-example
pnpm fixtures:compare-references --reference-dir references-v2 --observed-dir observed-v2
```

The pack command emits observations only. Codex completes each ignored
`references-v2/<fixture-id>.json` by opening every listed PDF page with image recognition. The compare command
fails unless all fifteen registered books have valid v2 files and every expected decision
matches. v1 and unknown schemas are rejected.

No human confirmation is part of this gate or the production pipeline. The detector computes
regions, canonical selection, body matches and hierarchy automatically; reference v2 is only
an independently authored offline oracle.

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
pnpm benchmark:build -- \
  --real-dir "$PWD/tests/fixtures/mineru/real" \
  --real-manifest performance-fixtures.json
pnpm benchmark:reference -- \
  --real-dir "$PWD/tests/fixtures/mineru/real" \
  --real-manifest performance-fixtures.json \
  --retain-dir "$PWD/.cache/007-performance" \
  --output-json "$PWD/.cache/007-performance.json" \
  --output-markdown "$PWD/.cache/007-performance.md"
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`performance-fixtures.json` uses the strict local fixture-manifest schema and lists only the
designated 97/441/583-page books. The build and reference benchmarks add the 500-page
synthetic book and retain the 300 ms uncached reader p95 target. Neither substitutes for the
fifteen-book exact correctness comparison.
