# Quickstart: Publishing Pipeline Performance Validation

## Prerequisites

- Node.js 24.x and pnpm 11.9.0
- local fifteen-book manifest, ZIPs and reference v2 files under the ignored real-fixture directory
- enough free disk for isolated baseline/candidate data roots
- baseline commit `c176fddfd1e103e7c14d38b823ee2a000f6345fd`

Verify the local fixtures before any timed work:

```sh
pnpm fixtures:verify-real --dir "$PWD/tests/fixtures/mineru/real"
pnpm fixtures:compare-references \
  --reference-dir "$PWD/tests/fixtures/mineru/real/references-v2" \
  --observed-dir "$PWD/tests/fixtures/mineru/real/observed-v2"
```

Expected: exactly fifteen registered fixtures and `15/15 exact` with no differences.

## Fast Gates

```sh
pnpm format
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contract
```

Expected: architecture validation is part of lint, all internal product imports are canonical `@/`,
the graph has zero forbidden edges/cycles, and negative architecture fixtures pass.

Run isolated complexity checks:

```sh
pnpm benchmark:compilation-complexity
```

Expected: fourfold source-region input grows by less than sixfold; typography, pagination and lookup
results match their correctness fixtures.

## Candidate and Recovery Gates

```sh
pnpm test:integration tests/integration/publication tests/integration/recovery
pnpm test:e2e tests/e2e/publishing-workbench.spec.ts tests/e2e/reader.spec.ts
```

Expected: one `build_candidate` produces preview/public semantic parity, publish performs zero
compile/render work, every crash point leaves the old publication plus a registered candidate or a
reclaimable orphan, and cancellation terminates within its bounded grace.

## Full Paired Benchmark

Run only from committed baseline and candidate states:

```sh
pnpm benchmark:pipeline-paired \
  --baseline-ref c176fddfd1e103e7c14d38b823ee2a000f6345fd \
  --candidate-ref HEAD \
  --real-dir "$PWD/tests/fixtures/mineru/real" \
  --order AB-BA-AB \
  --reader-requests 200 \
  --output "$PWD/.cache/008-publishing-performance/paired.json"
```

The runner expands to five pairs when CV exceeds 10%. Expected machine-readable gates:

- every run is 15/15 reference exact;
- paired median wall total improves at least 30%;
- slowest-five median improves at least 35%;
- accepted-to-preview improves at least 25%;
- publish-to-public improves at least 90%;
- no single book exceeds `max(5%, 1 s)` regression;
- RSS stays within `max(5%, 64 MiB)` of baseline;
- overlapping uncached reader p95 is at most 300 ms and search p95 is below 1,000 ms.

## Final Gate

Run the standard repository gates once after the last source change. `pnpm test` already includes
unit, contract, integration and architecture projects, so do not repeat the four project commands in
the same final pass.

```sh
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

Reuse the successful stress and paired-benchmark artifacts produced by T091 and T092; the final
static/test/build pass does not rerun those workloads. Then run Spec Kit analyze and converge.
Completion requires no unmitigated CRITICAL finding and no alternate publication path.
