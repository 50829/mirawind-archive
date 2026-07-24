# M1 performance report

- Captured: 2026-07-24T20:14:08.886Z
- Reference host: linux 7.0.0-28-generic, x64, 18 logical CPUs, 32695050240 bytes RAM
- Runtime: Node v24.15.0, SQLite 3.53.2 with WAL/FTS5 trigram
- Workload: every registered MinerU 3.4.4 fixture plus a 500-page, 20-block/page, 32-image synthetic stress fixture
- HTTP configuration: 200 measured requests per idle/search branch, 500 concurrent-build reads, concurrency 8
- Gates: uncached public reading p95 <= 300 ms; supported normal and 1–2-code-point search p95 < 1,000 ms
- Raw sanitized results: [m1-performance-results.json](./m1-performance-results.json)

| Fixture                  | SHA-256                                                          | MinerU    | Build wall ms | Peak process-tree RSS bytes | Idle read p95 ms | Concurrent-build read p95 ms | Normal search p95 ms | Short search p95 ms | Result |
| ------------------------ | ---------------------------------------------------------------- | --------- | ------------: | --------------------------: | ---------------: | ---------------------------: | -------------------: | ------------------: | ------ |
| real-mineru-b309a572298b | b309a572298b8f6f5d01c1d809c7391cba86e557a737fe5f84e7eef8acaf8f37 | 3.4.4     |     22655.411 |                  1031426048 |           14.689 |                       11.058 |               21.218 |              22.263 | PASS   |
| real-mineru-e80477ff22ac | e80477ff22ac436d996507f342d67831222e82ed4b2e09848c47ae0c407c869b | 3.4.4     |      3806.886 |                   298708992 |            6.911 |                         4.93 |               14.917 |              15.689 | PASS   |
| synthetic-stress-v1      | 8db7785dbc88f127cd2088f9c436e42a29f64daa75d531af9aa42e31bc4b6152 | synthetic |     11757.758 |                   719667200 |            9.616 |                        8.879 |               34.146 |              34.258 | PASS   |

## Interpretation

All fixture hashes were verified before processing. Every HTTP request returned the declared public cache policy and expected response type. The concurrent-build run observed a durable running build while the public route continued serving a published version; only after the build succeeded did SQLite advance `current_version_id`.

The JSON report contains exact p50/p95/p99 distributions, build phase durations, archive/output/index sizes, FTS build measurements, environment and dependency fingerprints. Search query text is omitted; only code-point counts and SHA-256 hashes are retained.
