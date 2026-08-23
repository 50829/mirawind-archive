# Quickstart: Naming, Import, and Path Closure Validation

## Prerequisites

- Node.js 24 and pnpm 11.9
- dependencies installed from the frozen lockfile
- Linux for filesystem, worker RSS and final performance evidence
- private real fixtures available only for final reference/performance gates
- in-app Browser connection available for final interactive verification

## 1. Naming and Import Boundaries

```bash
pnpm architecture:imports
pnpm architecture:check
pnpm test:architecture
```

Expected: every local import is relative, every cross-package import uses `@/`, cross-module edges
target named application APIs, no old `public.ts` facade remains, and semantic-name fixtures pass.

## 2. Path and Archive Boundaries

```bash
pnpm vitest run --project integration \
  tests/integration/archive/path-security.test.ts \
  tests/integration/archive/extraction.test.ts \
  tests/integration/storage/filesystem.test.ts

pnpm vitest run --project unit \
  tests/unit/compiler/pdf-contents-evidence.test.ts
```

Expected: canonical paths pass; normalization/case, Windows ambiguity, controls, symlinks, ZIP
identity changes, old PDF output and failed atomic writes reject with complete cleanup.

## 3. Repository Gates

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

## 4. Correctness and Performance

Run the existing fifteen-book reference exact gate and established representative build/read/search
commands. Expected: `15/15` exact, public read p95 at most 300 ms, and no representative wall/RSS
regression beyond `max(5%, 1 s)` / `max(5%, 64 MiB)`.

## 5. Browser Plugin

Start the Web and worker on a free localhost port other than 4321. Follow
[browser-verification.md](contracts/browser-verification.md) with the in-app Browser, including a
mobile viewport and console/network inspection. Record Chrome extension unavailability when present.
