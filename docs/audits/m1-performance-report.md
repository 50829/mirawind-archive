# M1 performance report

- Captured: 2026-07-25T04:05:14.865Z
- Reference host: linux 7.0.0-28-generic, x64, 18 logical CPUs, 32695050240 bytes RAM
- Runtime: Node v24.15.0, SQLite 3.53.2 with WAL/FTS5 trigram
- Workload: every registered MinerU 3.4.4 fixture plus a 500-page, 20-block/page, 32-image synthetic stress fixture
- HTTP configuration: 200 measured requests per idle/search branch, 500 concurrent-build reads, concurrency 8
- Gates: uncached public reading p95 <= 300 ms; supported normal and 1–2-code-point search p95 < 1,000 ms
- Acceptance set: D-097; 583-page and 441-page representative real books, 97-page real compatibility book, and 500-page repeatable synthetic stress book
- Raw sanitized results: [m1-performance-results.json](./m1-performance-results.json)

| Fixture                  | SHA-256                                                          | MinerU    | Build wall ms | Peak process-tree RSS bytes | Idle read p95 ms | Concurrent-build read p95 ms | Normal search p95 ms | Short search p95 ms | Result |
| ------------------------ | ---------------------------------------------------------------- | --------- | ------------: | --------------------------: | ---------------: | ---------------------------: | -------------------: | ------------------: | ------ |
| real-mineru-b309a572298b | b309a572298b8f6f5d01c1d809c7391cba86e557a737fe5f84e7eef8acaf8f37 | 3.4.4     |     17154.777 |                  1103712256 |            9.687 |                        7.644 |               24.104 |              21.012 | PASS   |
| real-mineru-e80477ff22ac | e80477ff22ac436d996507f342d67831222e82ed4b2e09848c47ae0c407c869b | 3.4.4     |      3566.575 |                   296435712 |             8.14 |                        7.939 |               14.103 |              13.619 | PASS   |
| real-mineru-a53faf7243d4 | a53faf7243d4bd41dab2c1be23ecd7c857bf14ca44133005bac2b27dddbec443 | 3.4.4     |     34702.517 |                  2899320832 |           26.205 |                        8.105 |                 41.8 |              43.351 | PASS   |
| synthetic-stress-v1      | 8db7785dbc88f127cd2088f9c436e42a29f64daa75d531af9aa42e31bc4b6152 | synthetic |      9929.978 |                   730877952 |            7.223 |                        8.461 |               32.492 |              32.409 | PASS   |

## Interpretation

All fixture hashes were verified before processing. The 583-page and 441-page real fixtures
establish representative large-book evidence, the 97-page real fixture expands real-output
compatibility coverage, and the 500-page synthetic fixture preserves a repeatable ordinary-CI
stress baseline without replacing a real book. Every HTTP request returned the declared
public cache policy and expected response type. The concurrent-build run observed a durable
running build while the public route continued serving a published version; only after the
build succeeded did SQLite advance `current_version_id`.

The JSON report contains exact p50/p95/p99 distributions, build phase durations, archive/output/index sizes, FTS build measurements, environment and dependency fingerprints. Search query text is omitted; only code-point counts and SHA-256 hashes are retained.
