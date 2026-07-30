# 008 pre-cutover compilation evidence

Overall result: **PASS for T053**

This report records the candidate-core correctness and compilation evidence collected before the
single runtime cutover. It does not replace the committed-candidate `AB/BA/AB` comparison, reader
concurrency gate or final RSS gate required by T092.

## Correctness evidence

- All fifteen hash-bound MinerU 3.4.4 fixtures were observed from the current preparation code and
  compared with the independent reference v2 files: `15/15 exact`, with no comparison issues.
- All fifteen fixtures completed the direct candidate path from real upload, hostile ZIP extraction
  and draft preparation through one `compiler-v5` / `semantic-html-v5-katex-0.18.1` build.
- Every candidate used `draft-preview-v5`, produced a durable immutable version tree and completed
  with zero blocking diagnostics. No legacy search-spool JSON was emitted.
- The nested role-boundary regression is covered by structure proposal and semantic configuration
  tests. A body chapter nested below a part can restore `body` after appendix material without being
  promoted to display level one.

## Complexity evidence

The source-region benchmark used eleven repetitions per size and preserved exact output:

| Root blocks | Median ms |
| ----------: | --------: |
|         500 |     0.718 |
|       1,000 |     0.471 |
|       2,000 |     0.708 |
|       4,000 |     1.568 |

The 4,000/1,000 ratio is `3.3275x`, below the required `<6x` gate.

## Fifteen-book direct-candidate observation

| Measurement                      |    Result |
| -------------------------------- | --------: |
| Fixtures passed                  |     15/15 |
| Total wall time                  | 580.333 s |
| Total accepted-to-candidate time | 577.506 s |
| Total candidate-build time       | 114.265 s |
| Candidate compile time           |  27.941 s |
| Candidate page-render time       |  41.206 s |
| Candidate search-spool time      |  29.101 s |
| Candidate finalization time      |  16.014 s |

The slowest end-to-end fixture took 81.685 seconds. The five slowest direct candidate builds took
between 9.521 and 16.809 seconds. Across draft preparation, the largest measured stage families were
repaired printed-contents analysis (193.829 seconds), initial printed-contents analysis (93.848
seconds), PDF evidence (55.652 seconds) and archive extraction (48.994 seconds). Source-region work
was 0.230 seconds in total, confirming that the former quadratic hotspot is no longer material.

## Interpretation and limits

The direct runner reuses the real upload and preparation path but stops the legacy worker after the
draft becomes ready and invokes the final candidate builder directly. Its 580.333-second total is a
pre-cutover diagnostic, not a paired comparison with the 901.234-second frozen baseline. It cannot
prove the final wall, accepted-to-preview or publish-to-public percentage gates.

The observed peak process-tree RSS was 2,963,922,944 bytes. This runner executes all candidate builds
inside one long-lived parent process, so V8 may retain committed pages between fixtures. The value is
recorded for investigation but is not valid final RSS evidence. T092 must execute baseline and
candidate in isolated process trees in `AB/BA/AB` order and enforce the per-book regression, RSS,
reader and search thresholds.

Raw local evidence is retained under `.cache/008-publishing-performance/` as
`t053-compilation-complexity.json`, `t053-reference-final.json` and
`t053-candidate-final-15.json`.

## Ordered page materialization follow-up

The candidate adapter now consumes each ordered `RenderedPage` once, materializes its preview and
public ReaderShell documents with that page's renderer CSS, writes both documents, appends manifest
and search rows, and releases the page. It no longer writes every route-neutral body under
`.rendered-pages` and reads the full set back after rendering. The union of renderer CSS is still
written to `published/styles/document.css` for the complete immutable artifact.

Four representative production-worker comparisons produced the following candidate-materialization
results:

| Fixture       | Before ms |  After ms | Change |
| ------------- | --------: | --------: | -----: |
| `106e`        | 2,302.097 | 1,888.731 | -18.0% |
| `81d`         | 2,055.534 | 2,036.827 |  -0.9% |
| `a53`         | 3,664.747 | 3,409.872 |  -7.0% |
| `f840` pair 1 | 3,613.556 | 4,248.180 | +17.6% |
| `f840` pair 2 | 3,910.721 | 3,545.772 |  -9.3% |

The fourth fixture exposed substantial single-run noise: its two-run medians differ by 3.6% for
materialization and 0.6% for complete wall time. It is therefore recorded as neutral within the
focused gate rather than claimed as either a regression or improvement. Process-tree RSS stayed
within the per-book tolerance for all four comparisons. The 14 focused candidate tests, both
TypeScript builds, production build and `4/4` reference-v2 comparison passed. These focused runs do
not replace formal T092 evidence.

## Whole-book heading link index follow-up

Semantic page rendering previously rebuilt the complete heading block-ID and normalized-title slug
lookup for every page. `compileBook()` now builds that immutable lookup once and every page renderer
must receive it explicitly; there is no optional compatibility path that can restore the repeated
scan.

The nearest retained prior runs and current focused runs produced:

| Fixture | Pages | Headings | Candidate before ms | Candidate after ms | Materialization before ms | Materialization after ms |
| ------- | ----: | -------: | ------------------: | -----------------: | ------------------------: | -----------------------: |
| `81d`   |    55 |    1,266 |           7,359.847 |          6,767.529 |                 2,012.892 |                1,682.313 |
| `106e`  |    25 |      474 |           6,017.331 |          6,024.786 |                 1,923.912 |                1,949.552 |
| `f840`  |    43 |      883 |           9,164.384 |          9,174.940 |                 3,455.740 |                3,438.552 |
| `a53`   |     9 |      233 |           6,782.976 |          6,665.408 |                 3,409.872 |                3,453.530 |

The largest heading-by-page workload shows the intended reduction; smaller products stay within
single-run noise. Peak process-tree RSS changed from `905,220,096` to `830,586,880` bytes for `81d`,
decreased for `106e` and `f840`, and increased by 3.0% for `a53`, within the focused per-book gate.
All four fresh observations match reference v2 exactly. These adjacent focused runs establish that
the change is worth retaining, but are not formal T092 paired evidence.
