# Quickstart: Publishing Pipeline Performance Validation

## Prerequisites

- Node.js 24.x and pnpm 11.9.0
- local fifteen-book manifest, ZIPs and reference v2 files under the ignored real-fixture directory
- enough free disk for isolated baseline/candidate data roots
- reference-exact baseline commit `93e0143225aad5570640b875ffc12d011cd784f9`

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

## Final Frozen-Baseline Comparison

First verify the saved baseline report, environment, fixture manifest and reference report hashes
under `.cache/008-publishing-performance/paired.json.runs/pair-01-baseline*`. Its commit must be
`93e01432` and its environment fingerprint must match the current host. Then run the clean current
candidate once over all fifteen books, using the baseline report's `fixture_order`:

```sh
pnpm benchmark:pipeline-profile \
  --real-dir "$PWD/tests/fixtures/mineru/real" \
  --fixture-ids "<comma-separated pair-01 baseline fixture_order>" \
  --profile-dir "$PWD/.cache/008-publishing-performance/current-b/profile" \
  --output "$PWD/.cache/008-publishing-performance/current-b/result.json"
```

Regenerate and compare all fifteen observed-v2 files independently. Expected gates:

- every run is 15/15 reference exact;
- anchored wall total improves at least 30%;
- slowest-five median improves at least 35%;
- accepted-to-preview improves at least 25%;
- publish-to-public improves at least 90%;
- no single book exceeds `max(5%, 1 s)` regression;
- RSS stays within `max(5%, 64 MiB)` of baseline;
- overlapping uncached reader p95 is at most 300 ms and search p95 is below 1,000 ms.

If an aggregate metric is within five percentage points of its gate, a book exceeds its wall/RSS
tolerance, a run fails or reference comparison is not exact, rerun only the affected B fixtures
twice and use their candidate median. Rerun A only when its saved binding is missing or invalid.

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

Reuse the successful stress and frozen-baseline comparison artifacts produced by T091 and T092; the final
static/test/build pass does not rerun those workloads. Then run Spec Kit analyze and converge.
Completion requires no unmitigated CRITICAL finding and no alternate publication path.
