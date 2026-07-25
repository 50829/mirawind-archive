# Quickstart: Library and Reading Loop

## Prerequisites

- Node.js 24 and pnpm 11.9
- the frozen dependency install
- a disposable data directory
- one small valid MinerU fixture for publication

## Build and schema validation

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm format
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:contract
pnpm build
```

Expected:

- migration 6 applies once and preserves existing versions;
- missing version projections are rebuilt only by worker reconciliation;
- projection, search and ready-version registration roll back together on injected failure;
- no public query reads draft title/alias caches.

## Browser validation

```bash
pnpm test:e2e
```

Required journeys:

1. anonymous desktop: `/library` → details → reading → search/next → library;
2. direct details URL with JavaScript disabled → reading → previous/next → library;
3. 360-pixel mobile: library dialog plus reader TOC/outline/search/download drawers;
4. administrator: import → preview → publish → view details/read → library;
5. public-to-private transition while old ETags and open pages exist.

Expected:

- public library/details bytes and ETags match between anonymous and administrator requests;
- drafts and private books appear only after authenticated private enhancement;
- all successful publish actions point to the same committed current version;
- serious/critical accessibility scan count is zero;
- dialog and drawer close restores focus and the library restores scroll.

## Performance validation

```bash
pnpm benchmark:library
```

The benchmark creates 1,000 bounded current presentation rows in disposable storage, runs
one background rebuild workload and measures uncached library and direct-details p50/p95/p99.
Both p95 values must be at or below 300 ms. The report must also prove that the request path
does not open `book.yaml` or parse full manifests.

## Manual local preview

```bash
./docker/local.sh
```

Open <http://localhost:4321/library>. Publish a disposable book through `/manage`, use the
success action to open it, test details close/Back restoration, then inspect the reader at a
narrow viewport. `./docker/local.sh stop` retains all data.

## Verified release result

The final verification run on 2026-07-25 used Node.js 24.15.0 and pnpm 11.9.0:

- `pnpm format`, `pnpm lint` and `pnpm typecheck` passed; Astro/TypeScript checked 262
  files with zero errors, warnings or hints.
- `pnpm test:unit` passed 72 tests in 17 files.
- `pnpm test:integration` passed 222 tests in 48 files.
- `pnpm test:contract` passed 40 tests in 10 files.
- `MIRAWIND_E2E_PORT=4322 pnpm test:e2e` passed all 9 production-stack journeys. Port 4322
  was used only because the retained local Docker preview already owned the default 4321.
- `pnpm build` produced the Astro server plus worker and CLI artifacts.
- `pnpm benchmark:library --requests 30 --warmups 5 --concurrency 4
--output-json docs/audits/m2a-library-performance.json --output-markdown
docs/audits/m2a-library-performance.md` passed with 1,000 current books and an observed
  concurrent rebuild: library p95 239.527 ms and details p95 21.927 ms.
- `pnpm audit:migration-recovery` passed against a disposable schema-6 copy of the
  registered real MinerU dual-version fixture, including stepwise migrations, online
  backup/restore and corrupt-current rollback.

The detailed evidence is in
[`m2a-library-release-verification.md`](../../docs/audits/m2a-library-release-verification.md),
[`m2a-library-performance.md`](../../docs/audits/m2a-library-performance.md), and
[`m2a-library-migration-recovery-report.md`](../../docs/audits/m2a-library-migration-recovery-report.md).
