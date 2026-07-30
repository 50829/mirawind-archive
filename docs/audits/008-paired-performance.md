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

## Removed unused output-byte rescans

The post-change CPU profile exposed an additional full scan of both generated Reader documents:
`CandidateMaterializationResult.outputBytes` called `Buffer.byteLength()` for every preview and
public HTML string, but no production or test consumer read the result. The field and scans were
deleted directly without a compatibility alias or an absence-only test.

Across the same four fixtures, candidate materialization changed by `2.1%`, `6.9%`, `-0.6%` and
`8.1%` faster, a median `4.5%`. The 13 ms regression was within single-run noise, while all four
complete candidate jobs improved. RSS decreased for three fixtures and rose by about 11 MB, or
1.3%, for one. The deletion does not participate in content generation; the candidate preview
integration test, both TypeScript configurations and production build passed.

Raw evidence is under ignored
`.cache/008-publishing-performance/after-output-byte-removal-*`. This focused run does not replace
or complete the owner-deferred T092 paired rounds.

## SAX route materialization

After removing duplicate parsing, the remaining full parse5 fragment DOM still dominated route
materialization and retained hundreds of megabytes for the largest formula page. At this checkpoint,
the replacement used `parse5-sax-parser` with source locations enabled. It recorded only parsed
route-neutral `href` and `src` attribute ranges, validated both URL policies, and reconstructed those
attributes with `entities.escapeAttribute()`. The old DOM construction and serialization path was
deleted. The later structured route-reference checkpoint below removed this remaining SAX pass and
dependency.

Focused results against the immediately preceding unused-byte-scan removal were:

| Fixture        | Materialization before | Materialization after | Change | Candidate job before | Candidate job after | RSS before | RSS after |
| -------------- | ---------------------: | --------------------: | -----: | -------------------: | ------------------: | ---------: | --------: |
| `a53faf7243d4` |                5.335 s |               3.800 s | -28.8% |              8.942 s |             7.475 s |   1.973 GB |  1.340 GB |
| `106e479f6de4` |                2.520 s |               2.302 s |  -8.6% |              7.134 s |             6.843 s |     839 MB |    783 MB |
| `81d6969edaf0` |                2.048 s |               2.056 s |  +0.4% |              7.245 s |             7.403 s |     757 MB |    807 MB |
| `f840921d3c8d` |                4.670 s |               3.614 s | -22.6% |             10.601 s |             9.698 s |   1.046 GB |  0.998 GB |

Median materialization improvement was 15.6% and median complete candidate-job improvement was
6.3%. The only candidate regression was 158 ms, below the `max(5%, 1 s)` tolerance. The only RSS
increase was about 47 MiB, below the `max(5%, 64 MiB)` tolerance.

The candidate preview/builder suite passed 14 tests, including preview/public normalized article
equality and route-token removal. Transient semantic comparison covered ordinary markup, table tree
correction, templates and MathML and produced `4/4` DOM-exact results against the replaced parser.
Unsafe URLs, malformed tokens and escaped attribute output remain covered. Fresh observations for
the four representative books compared `4/4` reference-v2 exact.

Raw machine-readable evidence is under ignored
`.cache/008-publishing-performance/sax-route-materialization-*` and
`.cache/008-publishing-performance/sax-route-observed-v2/`. These focused runs do not replace or
complete the owner-deferred T092 paired rounds.

## Aligned recurrence evidence

Printed-contents boundary scoring checked whether each extracted directory entry recurred among
later body headings. It previously rescored every entry against every later heading even though the
global alignment had already selected a monotonic body heading for most entries. The retained path
first verifies that selected heading when it is later than the candidate. Unmatched, ambiguous or
non-equivalent selections still execute the original exhaustive scan, so each recurrence decision
is unchanged and worst-case behavior remains available.

Focused current-source results against the preceding candidate-materialization checkpoint were:

| Fixture | Initial before | Initial after | Repaired before | Repaired after | Prepare change |
| ------- | -------------: | ------------: | --------------: | -------------: | -------------: |
| `106e`  |       509.3 ms |      495.5 ms |      1,349.3 ms |     1,179.5 ms |          -4.6% |
| `81d`   |       921.9 ms |      782.4 ms |      1,918.2 ms |     1,577.0 ms |          -6.6% |
| `f840`  |       753.4 ms |      663.9 ms |        925.0 ms |       852.3 ms |          -1.5% |

The first `106e` run reported an unrelated candidate-phase RSS spike; an adjacent rerun measured
805 MB versus the 771 MB baseline, within the 64 MiB tolerance. The other process-tree RSS results
also remained within their gates. The focused 92-test printed-contents suite, both TypeScript builds
and production build passed. Fresh observations generated after the change remained `3/3`
reference-v2 exact. Raw evidence is under ignored
`.cache/008-publishing-performance/recurrence-shortcut-*` and
`.cache/008-publishing-performance/recurrence-observed-v2/`. These focused runs do not replace or
complete the owner-deferred T092 paired rounds.

## Structured route-reference materialization

The current CPU profile showed the remaining SAX pass taking about `1.02 s` on `f840` while the two
actual URL variants took about `41 ms`. Each page renderer now derives a deterministic token scope
from the whole-book semantic digest and page ID, records the exact ordered `href`/`src` attribute
ranges immediately after semantic serialization, and includes those bounded references in the
ephemeral `RenderedPage`. The candidate adapter validates each recorded attribute against its token,
escapes both policy URLs, and reconstructs the two variants directly. Final preview/public HTML is
unchanged and contains no scope token. `parse5-sax-parser` and its lockfile entry were deleted.

Focused results against the immediately preceding heading-link-index checkpoint were:

| Fixture | Materialization before | Materialization after | Change | Candidate before | Candidate after | Wall change | RSS change |
| ------- | ---------------------: | --------------------: | -----: | ---------------: | --------------: | ----------: | ---------: |
| `f840`  |             3,438.6 ms |            2,423.5 ms | -29.5% |       9,174.9 ms |      8,028.7 ms |       -5.8% |      -7.4% |
| `a53`   |             3,453.5 ms |            2,197.2 ms | -36.4% |       6,665.4 ms |      5,466.8 ms |       -8.1% |      -2.1% |
| `106e`  |             1,949.6 ms |            1,248.9 ms | -35.9% |       6,024.8 ms |      5,432.2 ms |       -2.3% |      +4.2% |
| `81d`   |             1,682.3 ms |            1,398.9 ms | -16.8% |       6,767.5 ms |      6,667.5 ms |       -1.0% |      -9.4% |

The `106e` memory increase was about `32 MiB`, below both the 5% and 64 MiB focused tolerances; the
other three books decreased. The complete 645-test suite, both TypeScript builds, lint and the
235-file architecture graph, production build, and fresh `4/4` reference-v2 comparison passed. Raw
evidence is under ignored `.cache/008-publishing-performance/route-offsets-*`. These focused runs do
not replace or complete the owner-deferred T092 paired rounds.

## Write-time candidate inventory

The next candidate profile showed that assembly reopened every generated and copied file to build
`version.json`, although page HTML, spools, metadata, assets and verified copies already had their
bytes or SHA-256 available at the write boundary. Candidate assembly now records one bounded,
path-unique descriptor after each successful write or verified copy and builds the marker from that
adapter-local inventory. The old pre-marker tree walk was deleted. The finalizer remains an
independent full-tree hash and closure validation followed by file/directory fsync and atomic rename;
there is still no trust in the in-memory inventory at the durability boundary.

Focused results against the structured route-reference checkpoint were:

| Fixture | Inventory before | Inventory after | Candidate before | Candidate after | Wall change | Process-tree RSS change |
| ------- | ---------------: | --------------: | ---------------: | --------------: | ----------: | ----------------------: |
| `a53`   |         427.3 ms |          1.9 ms |          5.467 s |         5.255 s |       +0.1% |               -18.9 MiB |
| `106e`  |         386.6 ms |          1.4 ms |          5.432 s |         5.073 s |       -2.9% |               +11.1 MiB |
| `81d`   |         382.9 ms |          1.2 ms |          6.668 s |         6.082 s |       -4.0% |               +42.9 MiB |
| `f840`  |         710.3 ms |          1.8 ms |          8.372 s |         7.564 s |       -5.6% |               +16.6 MiB |

All memory changes remain within `max(5%, 64 MiB)`. The first wall result differs by only 13.7 ms
while its candidate child is 211.3 ms faster. The focused candidate/preview/recovery tests, both
TypeScript builds, lint and the 236-file architecture graph, production build, and fresh `4/4`
reference-v2 comparison passed. Raw evidence is under ignored
`.cache/008-publishing-performance/write-time-inventory-*`. This focused run does not replace or
complete the owner-deferred T092 paired rounds.

## Frozen original metadata

Each original ZIP has already been size-bounded and SHA-256 hashed while it is uploaded, then frozen
into the strictly validated source/config revision. Candidate assembly nevertheless copied the ZIP,
reopened the destination immediately, and recomputed the same metadata before the independent
finalizer reopened it again. Candidate assembly now records the frozen size and digest after a
successful copy. The finalizer still hashes the destination, compares every declared file, rejects
extra files, fsyncs the tree and atomically renames it; a focused mismatch test proves corrupt copied
bytes cannot reach an immutable version directory.

Focused results against the write-time inventory checkpoint were:

| Fixture | Original copy before | Original copy after | Change | Candidate change | Wall change | Process-tree RSS change |
| ------- | -------------------: | ------------------: | -----: | ---------------: | ----------: | ----------------------: |
| `a53`   |              52.1 ms |             21.4 ms | -59.0% |            -4.2% |       -2.6% |                   +1.0% |
| `106e`  |              56.9 ms |             18.3 ms | -67.8% |            -0.0% |       +0.4% |                   -2.8% |
| `81d`   |              63.0 ms |             21.4 ms | -66.1% |            +0.2% |       +0.5% |                   +3.0% |
| `f840`  |             200.3 ms |             64.3 ms | -67.9% |            -1.5% |       +0.0% |                   -3.0% |

All wall and RSS changes remain within their focused per-book tolerances, and fresh observations
remain `4/4` reference-v2 exact. Raw evidence is under ignored
`.cache/008-publishing-performance/trusted-original-metadata-*`. This focused run does not replace
or complete the owner-deferred T092 paired rounds.

## Rebuildable source closure

Draft source snapshots previously copied the selected MinerU bundle directory wholesale, including
`layout.pdf`, `span.pdf`, `middle.json`, `model.json`, content-list evidence and unreferenced images.
Candidate assembly then copied and hashed the same overbroad tree again. The prepare child already
had the exact validated image-resource closure, so it now writes that bounded relative-path list to
its short-lived staging tree. Parent finalization validates containment and regular-file status and
copies only normalized Markdown plus those resources. The original ZIP remains independently
retained and is still the sole input for source reprocessing.

| Fixture | Snapshot files |      Snapshot bytes | Prepare parent | Candidate source copy | Candidate job |   Wall |   RSS |
| ------- | -------------: | ------------------: | -------------: | --------------------: | ------------: | -----: | ----: |
| `a53`   |  `2,873 -> 64` |  `146.0 -> 2.37 MB` |         -61.9% |                -96.4% |        -17.3% | -10.3% | -9.4% |
| `106e`  | `1,847 -> 355` | `200.1 -> 17.99 MB` |         -45.3% |                -80.1% |        -12.3% |  -7.3% | -3.0% |
| `81d`   |   `581 -> 369` | `242.5 -> 15.91 MB` |         -24.6% |                -71.3% |         -2.0% |  -1.6% | -4.5% |
| `f840`  | `2,160 -> 449` | `357.5 -> 14.46 MB` |         -43.4% |                -84.9% |        -12.1% |  -8.1% | +1.1% |

A discarded prototype reconstructed the closure by parsing Markdown again in the parent. Although
it reduced copying, it increased prepare finalization by `12%–216%` and RSS by up to 36.5%; that
implementation was removed. The retained handoff adds no persistent content authority or reader
path. Resource closure, source reprocess, prepare/finalize and worker protocol tests pass, and fresh
observations remain `4/4` reference-v2 exact. Format, lint/architecture, both TypeScript builds, all
639 tests and the production build pass.

Raw evidence is under ignored
`.cache/008-publishing-performance/prepared-source-files-*` and
`.cache/008-publishing-performance/prepared-source-files-reference-report.json`. This focused run
does not replace or complete the owner-deferred T092 paired rounds.

## Single raster validation pass

Preparation previously read and fully decoded every resolved image, then candidate asset
materialization read and decoded the same image again to obtain the manifest dimensions and enforce
format, animation, side and pixel limits. The duplicate preparation pass has been removed. Resource
closure still resolves before the source snapshot is accepted, while the isolated candidate remains
the one enforcement boundary and cannot become ready until every retained image passes complete
decode validation.

| Fixture | Prepare child | Prepare phase | Candidate asset copy | Candidate job |  Wall |   RSS |
| ------- | ------------: | ------------: | -------------------: | ------------: | ----: | ----: |
| `a53`   |         -2.7% |         -1.9% |               -24.0% |         +0.1% | -0.8% | +5.8% |
| `106e`  |        -16.8% |        -15.0% |                -3.6% |         -0.6% | -6.8% | +2.9% |
| `81d`   |        -12.3% |        -11.9% |               -24.4% |         -4.7% | -6.8% | +3.0% |
| `f840`  |         -8.8% |         -7.7% |                -4.9% |         -6.7% | -3.8% | -4.6% |

The `a53` RSS change is about 63.1 MiB and remains below the 64 MiB focused tolerance; the other
three changes are smaller. A candidate integration test supplies a corrupt referenced PNG and proves
that it fails with `IMAGE_FORMAT_UNSUPPORTED` before immutable rename. Fresh observations remain
`4/4` reference-v2 exact. Format, lint/architecture, both TypeScript builds, all 640 tests and the
production build pass.

Raw evidence is under ignored
`.cache/008-publishing-performance/single-image-inspection-*` and
`.cache/008-publishing-performance/single-image-inspection-reference-report.json`. This focused run
does not replace or complete the owner-deferred T092 paired rounds.

## Container fast path and stable typography ranges

Every Markdown parse previously split the complete source into a character array and joined it
again to mask semantic-container markers, even when the document had no container marker. The
parser now returns the original source directly after the same line-level marker scan finds no
match; documents containing a marker retain the existing masking, nesting and validation path.

Typography also rebuilt technical-token ranges after length-preserving parentheses, quotes and
punctuation substitutions. It now rebuilds after ellipsis only when that substitution changed the
string length, retains the stable ranges through the length-preserving passes, and still rebuilds
after whitespace removal changes offsets.

| Fixture | Typography | Parse/normalize | Draft preparation | Complete wall | Process-tree RSS |
| ------- | ---------: | --------------: | ----------------: | ------------: | ---------------: |
| `a53`   |     -12.6% |           -6.5% |             -5.9% |         -1.5% |            +4.5% |
| `106e`  |      -2.7% |           -4.4% |             -3.2% |         +0.1% |            +3.2% |
| `81d`   |     -14.0% |           -7.9% |             -6.1% |         -0.9% |       +55.8 MiB* |
| `f840`  |     -14.0% |          -10.2% |             -8.4% |         +0.4% |            +4.4% |

`*` The first `81d` sample increased by about 66.4 MiB; an adjacent rerun measured a 55.8 MiB
increase and remained inside the 64 MiB tolerance. The two small wall increases are below the
per-book tolerance and occurred outside the improved parse and preparation stages. Existing parser,
typography and compiler tests passed, and newly generated observations remained `4/4`
reference-v2 exact. Format, lint and the 236-file architecture graph, both TypeScript builds, all
640 tests and the production build passed.

Raw evidence is under ignored `.cache/008-publishing-performance/current-f840-profile/`,
`container-fastpath-f840/`, `parser-typography-four/`, `parser-typography-81d-rerun/` and
`parser-typography-observed-v2/`. This focused run does not replace or complete the owner-deferred
T092 paired rounds.
