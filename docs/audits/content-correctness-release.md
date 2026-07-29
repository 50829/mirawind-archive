# Content correctness release evidence

- Executed: 2026-07-29
- Feature: `007-content-correctness`
- Result: **PASSED**

## Correctness gate

The strict reference-v2 comparison covered all 15 registered MinerU 3.4.4 books. All 15
matched exactly and the comparison reported zero issues across document selection, printed
contents regions, canonical selection, raw-heading accounting, body matches, hierarchy,
roles, navigation, splits, protected ranges and expected diagnostics.

The reference files were created from the saved Codex image-recognition transcripts and are
kept in the ignored local fixture directory. The observation and comparison commands do not
write expected decisions. The sanitized comparison report SHA-256 was
`c93c8964bac92ebd4decdcd970d2dcde8d270ac84a2954c7455905075816103a`.

## Performance gate

The performance run used the separate local `performance-fixtures.json` manifest containing
only the designated 97-, 441- and 583-page books, plus the generated 500-page stress book.
All four workloads passed build, publication, reading and search checks.

| Measurement                    | Worst observed p95 |     Gate |
| ------------------------------ | -----------------: | -------: |
| Idle public reading            |          18.541 ms |   300 ms |
| Reading during a running build |          17.709 ms |   300 ms |
| Normal and short search        |          35.680 ms | 1,000 ms |

The run observed a durable build while the old publication remained readable and verified
that `current_version_id` advanced only after a successful build. The sanitized performance
report SHA-256 was
`5c7ad790f9d7cc77be0ba07442d9173ad6bdd86bf9600fe95fcc4713bdaee062`.

## Reproduction

```sh
pnpm fixtures:verify-real --dir "$PWD/tests/fixtures/mineru/real"
pnpm fixtures:compare-references \
  --reference-dir "$PWD/tests/fixtures/mineru/real/references-v2" \
  --observed-dir <current-observation-directory>
pnpm benchmark:reference \
  --real-dir "$PWD/tests/fixtures/mineru/real" \
  --real-manifest performance-fixtures.json \
  --retain-dir "$PWD/.cache/007-performance" \
  --output-json "$PWD/.cache/007-performance.json" \
  --output-markdown "$PWD/.cache/007-performance.md"
```

Correctness and performance remain separate gates: the 15-book oracle is never substituted
by the three-real-book performance manifest, and the stress fixture never substitutes for a
real book.
