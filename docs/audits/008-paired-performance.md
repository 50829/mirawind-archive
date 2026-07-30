# 008 paired publishing performance

Date: 2026-07-30

## Current status

This report currently contains only the first committed `A -> B` pair requested during focused
optimization. It is valid diagnostic evidence, but it does not complete T092 or the required
`AB/BA/AB` result.

- Baseline: `93e0143225aad5570640b875ffc12d011cd784f9`
- Candidate: `f5c91a5698634770e3732e71f9de4bc93911d54f`
- Both worktrees were clean and used the same bound environment and fifteen-fixture order.
- Baseline and candidate were both `15/15` reference-v2 exact.

## First pair

| Gate | Baseline | Candidate | Change | Required | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Total wall | 887.842 s | 623.961 s | 29.72% faster | >=30% | MISS |
| Slowest five | - | - | 35.72% faster | >=35% | PASS |
| Accepted to preview | 642.958 s | 620.720 s | 3.46% faster | >=25% | MISS |
| Publish to public | 241.975 s | 0.020 s | 99.99% faster | >=90% | PASS |
| Peak process-tree RSS | 2.240 GB | 3.008 GB | 34.27% higher | <=max(5%, 64 MiB) | MISS |

Fourteen fixtures became faster and eight improved by at least 30%. The only wall-time regression
was `real-mineru-106e479f6de4`, from 54.106 seconds to 59.943 seconds, a 10.79% increase that exceeds
the per-book tolerance. The largest improvement was `real-mineru-f840921d3c8d`, from 153.311 seconds
to 72.759 seconds, or 52.54%.

## Profile interpretation

Candidate consolidation removed most duplicate preview/publication work:

| Job family | Baseline | Candidate |
| --- | ---: | ---: |
| Draft preparation | 389.128 s | 424.181 s |
| Preview and publication builds / candidate build | 393.041 s | 121.605 s |

The remaining latency is in printed-contents analysis during draft preparation:

| Stage | Baseline | Candidate |
| --- | ---: | ---: |
| Initial printed contents | 22.038 s | 97.946 s |
| Repaired printed contents | 53.602 s | 199.517 s |

For the regressing `real-mineru-106e479f6de4` fixture, preparation increased from 21.542 seconds to
43.667 seconds; initial and repaired printed-contents analysis account for most of that increase.

The RSS failure is concentrated in `real-mineru-a53faf7243d4`. Its candidate process-tree peak was
3.008 GB. The first pair established the regression but did not isolate the retained object graph.

## Focused printed-contents correction

CPU profiling of the only regressing fixture, `real-mineru-106e479f6de4`, found 25.243 seconds of
self CPU in repeated `SourceTextIndex` construction. Printed-directory extraction rebuilt the full
UTF-8 source index for every directory-entry offset. Reusing one index per
`detectPrintedContents()` call produced this focused before/after result:

| Measurement | Before | After | Change |
| --- | ---: | ---: | ---: |
| Wall | 59.694 s | 31.955 s | 46.47% faster |
| Draft preparation | 43.985 s | 16.361 s | 62.80% faster |
| Initial printed contents | 10.925 s | 2.186 s | 79.99% faster |
| Repaired printed contents | 25.659 s | 7.182 s | 72.01% faster |

The focused after-run remained reference-v2 exact. The printed-contents and source-region suite
passed 94 tests, followed by the full typecheck. This result fixes the observed per-book regression,
but it is not substituted for a fresh fifteen-book paired result.

## Focused memory diagnosis

A retained diagnostic run of `real-mineru-a53faf7243d4` measured 43.035 seconds wall time, 2.114 GB
peak process-tree RSS, 1.999 GB candidate-process RSS and 1.636 GB candidate heap. These values are
diagnostic rather than directly comparable with the first paired RSS gate because the harness and
retention instrumentation differ.

The immutable output tree was approximately 287 MB, the source tree 146 MB and the manifest only
6.42 MB. The largest rendered preview and public pages were each 22.3 MB, with the next largest pages
10.7 MB each. `manifest_build` begins after page materialization, so its high starting heap is
residual and does not show that the manifest created the peak.

The retained objects instead point to page rendering: `renderPages()` can start four whole-page
unified/KaTeX renders, begin another page before yielding the current result, and retain completed
HTML in settled promises until the ordered consumer writes it. The next optimization is therefore
to keep four as the maximum concurrency while reducing concurrency by page weight/block count for
oversized pages, then verify bounded retention on this fixture.

Raw machine-readable evidence remains in the ignored
`.cache/008-publishing-performance/paired.json.runs/` directory. Focused profiler evidence is in
the ignored `.cache/008-publishing-performance/focused-before/`,
`.cache/008-publishing-performance/focused-after-index/` and
`.cache/008-publishing-performance/memory-before/` directories.
