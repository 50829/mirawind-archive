# Publishing quality release evidence

Overall result: **PASS**

This report closes the publishing-quality scope at commit `ff160c3`: persisted Markdown
preprocessing, printed-contents reference regions, shared preview/publication compilation,
KaTeX asset closure, strict v1/v2 configuration compatibility, immutable republishing,
hierarchical reader navigation and the global Tailwind color system.

## Functional evidence

- Contract, unit and integration coverage verifies strict v1/v2 schemas, deterministic
  migration, UTF-8 region hashes, high-confidence printed-contents matching, reversible
  active-document filtering, preview/publication semantic identity, stale-preview
  rejection, local KaTeX asset integrity and rollback-safe immutable versions.
- Browser acceptance verifies typography provenance and protected tokens, printed-contents
  review and bulk reversal, preview/publication parity, one visible KaTeX representation
  with accessible MathML, successful local CSS/WOFF2 requests, failed-formula fallback,
  successful republishing, desktop/mobile/no-script reader navigation and private-resource
  exclusion.
- Product UI colors use the D-106 Tailwind palette through utilities or `--color-*`
  variables. `pnpm lint` rejects direct product-source color literals and parallel color
  namespaces.
- Preview documents use the same versioned renderer and reader stylesheets as published
  pages. The preview iframe permits same-origin asset loading but does not permit scripts.

## Response-class evidence

- Authenticated preview HTML, diagnostics and resources: `private, no-store` plus
  `noindex`.
- Public reader HTML: `public, max-age=0, must-revalidate`; private and missing books remain
  indistinguishable to anonymous callers and are never cached.
- Version-pinned published resources: authorized immutable response policy; original
  downloads: `private, no-store`.
- The complete route-policy matrix and OpenAPI contract enumerate the reprocessing endpoint
  as an authenticated private mutation. Full route discovery fails if any new page omits
  policy evidence.

## Performance and stress evidence

- Captured: 2026-07-25T11:41:01.223Z
- Reference host: linux 7.0.0-28-generic, x64, 18 logical CPUs, 32695050240 bytes RAM
- Runtime: Node v24.15.0, SQLite 3.53.2 with WAL/FTS5 trigram
- Workload: every registered MinerU 3.4.4 fixture plus a 500-page, 20-block/page, 32-image synthetic stress fixture
- HTTP configuration: 200 measured requests per idle/search branch, 500 concurrent-build reads, concurrency 8
- Gates: uncached public reading p95 <= 300 ms; supported normal and 1–2-code-point search p95 < 1,000 ms
- Raw sanitized results: [publishing-quality-results.json](./publishing-quality-results.json)

| Fixture                  | SHA-256                                                          | MinerU    | Build wall ms | Peak process-tree RSS bytes | Idle read p95 ms | Concurrent-build read p95 ms | Normal search p95 ms | Short search p95 ms | Result |
| ------------------------ | ---------------------------------------------------------------- | --------- | ------------: | --------------------------: | ---------------: | ---------------------------: | -------------------: | ------------------: | ------ |
| real-mineru-b309a572298b | b309a572298b8f6f5d01c1d809c7391cba86e557a737fe5f84e7eef8acaf8f37 | 3.4.4     |     32775.585 |                   864546816 |               12 |                       14.936 |               19.445 |              19.483 | PASS   |
| real-mineru-e80477ff22ac | e80477ff22ac436d996507f342d67831222e82ed4b2e09848c47ae0c407c869b | 3.4.4     |      4023.016 |                   305172480 |           10.505 |                        8.988 |               18.411 |              18.675 | PASS   |
| real-mineru-a53faf7243d4 | a53faf7243d4bd41dab2c1be23ecd7c857bf14ca44133005bac2b27dddbec443 | 3.4.4     |     86941.493 |                  2025443328 |            9.732 |                        9.792 |               31.743 |              37.929 | PASS   |
| synthetic-stress-v1      | 8db7785dbc88f127cd2088f9c436e42a29f64daa75d531af9aa42e31bc4b6152 | synthetic |     34147.533 |                   679858176 |           15.571 |                       14.997 |               31.215 |              31.537 | PASS   |

## Interpretation

All fixture hashes were verified before processing. Every HTTP request returned the declared public cache policy and expected response type. The concurrent-build run observed a durable running build while the public route continued serving a published version; only after the build succeeded did SQLite advance `current_version_id`.

The JSON report contains exact p50/p95/p99 distributions, build phase durations, archive/output/index sizes, FTS build measurements, environment and dependency fingerprints. Search query text is omitted; only code-point counts and SHA-256 hashes are retained.
