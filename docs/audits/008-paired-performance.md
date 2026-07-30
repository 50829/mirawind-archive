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

| Gate                  |  Baseline | Candidate |        Change |          Required | Result |
| --------------------- | --------: | --------: | ------------: | ----------------: | ------ |
| Total wall            | 887.842 s | 623.961 s | 29.72% faster |             >=30% | MISS   |
| Slowest five          |         - |         - | 35.72% faster |             >=35% | PASS   |
| Accepted to preview   | 642.958 s | 620.720 s |  3.46% faster |             >=25% | MISS   |
| Publish to public     | 241.975 s |   0.020 s | 99.99% faster |             >=90% | PASS   |
| Peak process-tree RSS |  2.240 GB |  3.008 GB | 34.27% higher | <=max(5%, 64 MiB) | MISS   |

Fourteen fixtures became faster and eight improved by at least 30%. The only wall-time regression
was `real-mineru-106e479f6de4`, from 54.106 seconds to 59.943 seconds, a 10.79% increase that exceeds
the per-book tolerance. The largest improvement was `real-mineru-f840921d3c8d`, from 153.311 seconds
to 72.759 seconds, or 52.54%.

## Profile interpretation

Candidate consolidation removed most duplicate preview/publication work:

| Job family                                       |  Baseline | Candidate |
| ------------------------------------------------ | --------: | --------: |
| Draft preparation                                | 389.128 s | 424.181 s |
| Preview and publication builds / candidate build | 393.041 s | 121.605 s |

The remaining latency is in printed-contents analysis during draft preparation:

| Stage                     | Baseline | Candidate |
| ------------------------- | -------: | --------: |
| Initial printed contents  | 22.038 s |  97.946 s |
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

| Measurement               |   Before |    After |        Change |
| ------------------------- | -------: | -------: | ------------: |
| Wall                      | 59.694 s | 31.955 s | 46.47% faster |
| Draft preparation         | 43.985 s | 16.361 s | 62.80% faster |
| Initial printed contents  | 10.925 s |  2.186 s | 79.99% faster |
| Repaired printed contents | 25.659 s |  7.182 s | 72.01% faster |

The focused after-run remained reference-v2 exact. The printed-contents and source-region suite
passed 94 tests, followed by the full typecheck. This result fixes the observed per-book regression,
but it is not substituted for a fresh fifteen-book paired result.

## Correctness receipt reuse

The paired runner previously regenerated all fifteen observed references after every timed run.
Correctness depends on the implementation commit and the bound fixture/reference set, not pair
position, so a complete three-pair run repeated the same observer work six times. The runner now
stores one exact receipt per implementation commit, fixture-manifest hash and ZIP/reference-binding
hash. A later pair reuses that receipt; a resumed run may seed it from its existing `reference.json`
only after the report hash recorded by the run matches.

The focused helper test proves that two requests for one binding call the observer producer once and
that a changed binding is rejected. Both existing pair-01 reports were also hash-verified and seeded
locally as `15/15` exact without processing the books again. A normal `AB/BA/AB` run therefore needs
two observer passes instead of six. This removes benchmark-only duplicate work and is not counted as
a product pipeline speedup or a new formal pair.

## Shared printed-contents document index

The next retained CPU profile showed that title cleanup and numbering inference had become the
dominant draft-preparation cost. The initial, repaired MinerU/PDF and native-PDF detections all
operate on the same normalized document, but each pass rebuilt source/hash indexes and repeatedly
derived the same body-heading match features. One immutable document index now owns the UTF-8
source index, source hash, root titles, heading lookup and normalized heading match facts for all
three detections. Matching scores, thresholds and alignment rules are unchanged.

The focused `real-mineru-106e479f6de4` before/after run used the same current candidate pipeline:

| Measurement               |   Before |    After |        Change |
| ------------------------- | -------: | -------: | ------------: |
| Total wall                | 28.481 s | 23.650 s | 16.97% faster |
| Accepted to preview       | 28.319 s | 23.499 s | 17.02% faster |
| Draft preparation         | 15.371 s | 10.507 s | 31.65% faster |
| Initial printed contents  |  2.143 s |  0.685 s | 68.02% faster |
| Repaired printed contents |  7.143 s |  3.408 s | 52.28% faster |
| Peak process-tree RSS     | 929.3 MB | 952.8 MB |  2.53% higher |

The current source then regenerated all fifteen observed-v2 files and remained `15/15`
reference-exact. The focused result is diagnostic evidence only and does not replace another formal
pair or complete T092.

## Focused memory diagnosis

A retained diagnostic run of `real-mineru-a53faf7243d4` measured 43.035 seconds wall time, 2.114 GB
peak process-tree RSS, 1.999 GB candidate-process RSS and 1.636 GB candidate heap. These values are
diagnostic rather than directly comparable with the first paired RSS gate because the harness and
retention instrumentation differ.

The immutable output tree was approximately 287 MB, the source tree 146 MB and the manifest only
6.42 MB. The largest rendered preview and public pages were each 22.3 MB, with the next largest pages
10.7 MB each. `manifest_build` begins after page materialization, so its high starting heap is
residual and does not show that the manifest created the peak.

The retained objects initially suggested that overlapping page renders were the main cause. A
page-block-weighted scheduler was implemented and measured before being removed. It changed peak
process-tree RSS from 2.114 GB to 2.162 GB and candidate heap from 1.636 GB to 1.704 GB. This
falsified the concurrency hypothesis: the retained peak is dominated by one formula-heavy page and
short-lived render allocations rather than multiple oversized pages running together.

## Single-pass KaTeX rendering

Source inspection then found that every valid formula called `katex.renderToString()` once during
tree cloning and discarded its markup, after which `rehype-katex` rendered it again and parsed the
result into a large HAST. The replacement renders once after imported HTML sanitization and sends
only KaTeX's `trust: false` markup to final stringification. Invalid formulas retain the same bounded
source fallback and localized diagnostic. The unused `rehype-katex` dependency was removed.

Focused results:

| Fixture and measurement         |   Before |    After |        Change |
| ------------------------------- | -------: | -------: | ------------: |
| `a53faf7243d4` candidate build  | 19.075 s | 10.554 s | 44.67% faster |
| `a53faf7243d4` total wall       | 43.035 s | 34.570 s | 19.67% faster |
| `a53faf7243d4` process-tree RSS | 2.114 GB | 2.099 GB |   0.75% lower |
| `a53faf7243d4` candidate RSS    | 2.000 GB | 1.985 GB |   0.72% lower |
| `106e479f6de4` candidate build  | 11.319 s |  7.141 s | 36.91% faster |
| `106e479f6de4` total wall       | 31.955 s | 27.346 s | 14.42% faster |
| `106e479f6de4` process-tree RSS | 956.7 MB | 899.9 MB |   5.94% lower |

The memory-heavy book contains 15,911 formulas across nine output pages. Parsing both retained
versions and serializing each `.katex` subtree produced exact before/after equality on all nine
pages. Preview and public page byte counts were also unchanged. The current observed-v2 set remains
15/15 reference exact. These are focused diagnostics, not a replacement for a fresh paired result.

A later clean benchmark exposed that the first single-pass implementation also assumed every math
node in the source tree survived into HAST in the same order. That is false for non-rendered
definition/metadata nodes and caused `MATH_SOURCE_ALIGNMENT_INVALID` on a real candidate build.
Generated formula nodes now carry a per-render opaque marker through sanitization, resolve their
source without depending on traversal order, and remove the marker before serialization. Visible
formula source/display-mode checks and duplicate-marker rejection remain; the invalid whole-tree
cardinality gate was removed. The same real fixture completed after this correction.

Raw machine-readable evidence remains in the ignored
`.cache/008-publishing-performance/paired.json.runs/` directory. Focused profiler evidence is in
the ignored `.cache/008-publishing-performance/focused-before/`,
`.cache/008-publishing-performance/focused-after-index/` and
`.cache/008-publishing-performance/memory-before/`,
`.cache/008-publishing-performance/memory-after-weighted/`,
`.cache/008-publishing-performance/memory-after-raw-math/` and
`.cache/008-publishing-performance/focused-after-raw-math/` directories.

## Sealed extraction handoff

Analysis and preparation previously ran the complete hostile-ZIP extractor independently. The
successful analysis tree is now sealed under its registered import and claimed once by preparation;
missing or invalid markers fall back to normal extraction. Rejected imports do not retain a tree,
and cancellation/reconciliation remove derived trees without deleting the original ZIP.

The same 97-page fixture was run through the complete production worker before and after rebuilding
the process bundle. The old prepare child spent 73.498 ms in `archive_extract`. The new prepare
profile has `archive_reused=1` and no `archive_extract` stage; child duration changed from 1,057.729
to 1,052.277 ms and peak process-tree RSS from 346.751 MB to 306.385 MB. Whole-run wall changed from
3,055.565 to 3,160.015 ms because unrelated PDF evidence and candidate stages varied, so this run
proves removal of the duplicate extraction but is not used as a formal aggregate speed claim. Prior
fifteen-book profiles measured about 53.2 seconds in the removed second extraction.

Raw results are retained under ignored
`.cache/008-publishing-performance/sealed-extraction-current*/` directories. T092 remains open; this
focused evidence does not replace the owner-deferred remaining paired rounds.

## Detection-scoped title similarity profiles

The retained CPU profile for `real-mineru-81d6969edaf0` showed that printed-contents alignment
rebuilt the same bigram and character-frequency maps across repeated TOC/body title comparisons.
Detection now owns one explicitly passed similarity index. It caches only normalized-text features
for that detection call; matching thresholds, scores, output contracts and process lifetime are
unchanged, and no global cache was introduced.

Two before and two after runs on the same 1,278-page fixture produced these median changes:

| Measurement               | Before median | After median |       Change |
| ------------------------- | ------------: | -----------: | -----------: |
| Repaired printed contents |       4.700 s |      4.015 s | 14.6% faster |
| Draft preparation         |      11.249 s |     10.355 s |  8.0% faster |
| Total wall                |      23.988 s |     23.108 s |  3.7% faster |

Peak process-tree RSS was 812.4/815.3 MB before and 835.9/774.0 MB after, with no median
regression. The current source regenerated every observed-v2 artifact and compared `15/15` exact
against `references-v2`. Raw focused and comparison evidence remains under the ignored
`.cache/008-publishing-performance/after-similarity-index*` paths. This focused result does not
replace or complete the owner-deferred T092 paired rounds.

## Indexed layout page-label supplementation

The next current-source CPU profile showed that missing printed page-label supplementation still
rescanned all layout records for every group and page, reparsed the same labels and searched both
directions from every missing item. The replacement builds detection-local records-by-page,
maximum-bottom, supplemental-label and nearest-label indexes once. It preserves source order,
geometric thresholds and matching decisions; the old repeated-scan helpers were deleted.

On the same 1,278-page fixture, the median of two current-source runs before and after the change
was:

| Measurement               | Before median | After median |       Change |
| ------------------------- | ------------: | -----------: | -----------: |
| Repaired printed contents |       4.015 s |      1.846 s | 54.0% faster |
| Draft preparation         |      10.355 s |      9.254 s | 10.6% faster |
| Total wall                |      23.108 s |     21.391 s |  7.4% faster |

Median process-tree RSS decreased from about 805 MB to 774 MB. Four representative books covering
the large printed-contents case, the former wall regression, the formula/memory case and the former
slowest case were regenerated and remained `4/4` reference-v2 exact. Post-change CPU evidence no
longer lists `pageLabel` or `supplementMissingListPageLabels` as hotspots. Raw focused evidence is
retained under the ignored `.cache/008-publishing-performance/after-layout-index*` paths. This
focused result does not replace or complete the owner-deferred T092 paired rounds.

## Reused typography protection ranges

Typography normalization recomputed identical protected-token ranges while cleaning punctuation
and then spacing on the same stable string. The retained change computes those ranges once and
passes them into both transformations; parsing rules and output are unchanged.

Across four representative books, typography stage time changed by `9.8%`, `-1.1%`, `8.7%` and
`8.1%`, for a median 8.4% improvement. A follow-up monotonic range cursor regressed all four stage
measurements and was deleted rather than retained. Fresh observations from the retained output
remain `4/4` reference-v2 exact. Raw evidence is under ignored
`.cache/008-publishing-performance/after-typography-range-reuse*` and
`.cache/008-publishing-performance/after-typography-cursor*` paths. This focused result does not
replace or complete the owner-deferred T092 paired rounds.

## Single-parse route materialization

The candidate materializer previously parsed every route-neutral semantic page twice with parse5:
once for private preview URLs and again for public URLs. CPU profiling of the formula-heavy fixture
showed parse5 tokenization, parsing and the resulting garbage collection dominating the remaining
materialization cost. The replacement parses once, records only validated route-neutral `href` and
`src` attributes, applies and validates each route policy in turn, and serializes both outputs from
the same fragment. The old single-output materializer was deleted.

Focused current-source results against the immediately preceding stage-attribution run were:

| Fixture        | Pages | Materialization before | Materialization after | Change | Candidate job before | Candidate job after |
| -------------- | ----: | ---------------------: | --------------------: | -----: | -------------------: | ------------------: |
| `a53faf7243d4` |     9 |                7.184 s |               5.452 s | -24.1% |             10.800 s |             9.281 s |
| `106e479f6de4` |    25 |                3.561 s |               2.706 s | -24.0% |              8.238 s |             7.326 s |
| `81d6969edaf0` |    55 |                2.289 s |               2.035 s | -11.1% |              7.645 s |             7.436 s |
| `f840921d3c8d` |    43 |                6.291 s |               5.080 s | -19.3% |             12.487 s |            11.177 s |

Median candidate-materialization improvement was 21.6%. Process-tree RSS decreased from 2.132 GB
to 1.996 GB, 951 MB to 828 MB and 891 MB to 785 MB for the first three fixtures. The fourth changed
from 1.050 GB to 1.067 GB, a 1.6% increase within the configured tolerance. A fresh independent
observation and comparison remained `4/4` reference-v2 exact.

Raw machine-readable results are under ignored
`.cache/008-publishing-performance/candidate-stage-attribution*`,
`.cache/008-publishing-performance/after-route-variants-*` and
`.cache/008-publishing-performance/after-route-variants-observed-v2/`. These focused runs do not
replace or complete the owner-deferred T092 paired rounds.
