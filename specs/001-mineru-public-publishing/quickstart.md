# Quickstart and acceptance guide

This is the implemented M1 acceptance guide. Commands below are release-tested unless a
step explicitly requires the administrator's interactive credentials or production HTTPS
origin.

## 1. Prerequisites

- Linux host or Linux container runtime
- Node.js 24 LTS and the repository-pinned pnpm version
- HTTPS origin for production Passkeys
- One persistent directory whose `staging` and `versions` paths share a filesystem
- Representative and hostile fixtures under `tests/fixtures/`
- During final testing, the two or three real several-hundred-page MinerU 3.4.4 ZIPs supplied
  by the administrator under the local Git-ignored `tests/fixtures/mineru/real/` directory
  or a Git-external directory such as `/srv/mirawind-test-fixtures/real-mineru/`

Create local configuration from the committed example and set at least:

```text
MIRAWIND_DATA_DIR=/absolute/path/outside/the/repository
MIRAWIND_PUBLIC_ORIGIN=https://library.example.test
MIRAWIND_AUTH_SECRET=<generated secret>
MIRAWIND_PASSKEY_RP_ID=library.example.test
```

Secrets must not be committed. Production rejects a non-HTTPS public origin except for the
documented localhost development case.

## 2. Install, migrate and bootstrap

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
node dist/processes/cli/index.js db migrate
node dist/processes/cli/index.js admin bootstrap --data-dir "$MIRAWIND_DATA_DIR"
```

The bootstrap command prompts in a TTY. Start one Web and one worker process:

```bash
NODE_ENV=production pnpm start
NODE_ENV=production pnpm worker
```

Expected:

- `/login` offers Passkey first and fallback password second.
- No registration or Web recovery endpoint exists.
- After password login, the administrator can register named Passkeys up to the limit.
- Fallback passwords outside 16–128 characters are rejected. Passkey changes after the
  five-minute freshness window request reauthentication; deleting the last Passkey always
  requests the fallback password again.
- Anonymous `/manage`, API, draft and preview requests are non-cacheable and reveal no
  private resource.

## 3. Happy-path vertical slice

1. Upload the representative MinerU ZIP from `/manage`.
2. Observe streamed upload progress and a durable queued/running job.
3. For a high-confidence `full.md` or CLI-style candidate, verify automatic selection.
4. Inspect the proposed headings, diagnostics, TOC inclusion, displayed title/level, role
   and heading-only page starts.
5. Save a change and confirm a new `book.yaml` revision exists while Markdown is unchanged.
6. Select Publish and keep a separate anonymous reading page open during the build.
7. Verify the old page remains responsive until cutover, then the complete new version
   appears on revalidation.
8. Search three-or-more-character Chinese and mixed-language phrases and follow a result to
   its block.
9. Search one/two characters and verify only title/author/heading scope plus the UI notice.
10. Download the MinerU ZIP, interrupt it, resume with `Range`, and compare SHA-256.

Expected publication evidence:

- One immutable version directory contains `version.json`, `book.yaml`, manifest, source,
  original ZIP, generated pages and versioned assets.
- SQLite alone names the current version.
- Manifest, file and search ID/count validation completed before cutover.
- Public HTML is `public, max-age=0, must-revalidate` with a strong ETag.
- Versioned reading assets are `private, max-age=31536000, immutable`.
- Original downloads are `private, no-store`, attachment-only, range-capable and `noindex`.

## 4. Candidate and archive boundaries

Run the fixture suite:

```bash
pnpm test:integration -- archive import
```

It must cover:

- Cloud `full.md`, CLI `<stem>.md`, a generic single Markdown requiring confirmation,
  ambiguous Markdown and a multi-book rejection;
- nested wrapper directories, Windows separators, absolute/traversal paths, Unicode
  normalization collisions and duplicate normalized paths;
- symlink/hardlink/special files, encryption, multi-disk and unsupported compression;
- malformed headers, metadata lies, entry/total byte ceilings, 64 MiB ratio threshold and
  200:1 rejection, 20,000-entry limit, depth/component/path limits and timeout;
- missing/cross-root resources and images at/beyond side and pixel limits.

For every rejected fixture, assert:

- no draft or version is readable;
- staging is removed;
- the prior current version and search results are unchanged;
- logs expose only a stable category and opaque identifiers.

## 5. Publication crash matrix

```bash
pnpm test:integration -- publication recovery
```

Inject a forced process exit:

- before and after staging fsync;
- before and after atomic rename;
- before, during and after ready-version/search transaction;
- before and after guarded current-pointer commit;
- during heartbeat, timeout cancellation and cleanup.

Restart Web and worker after each point. Readers must see one complete old or new version,
never a mixture. Expired work becomes `interrupted`; only one infrastructure retry is
automatic. A recovered `ready` version remains unpublished until explicit publish retry.
Missing/corrupt current files roll only the affected book back to a verified predecessor or
produce book-scoped `503`.

## 6. Authorization, cache and download matrix

```bash
pnpm test:integration -- auth cache download
pnpm test:e2e
```

For anonymous, authenticated administrator, public, private, draft, current, old-published,
ready and nonexistent combinations, test page, asset, preview, search and original routes.
Authorization must run before `If-None-Match`, `If-Range` and `Range`. Private and missing
representations must be indistinguishable and non-cacheable. Changing a book to private must
deny the next anonymous request without waiting for cache expiry or rebuild.

## 7. Schema and reproducibility gates

```bash
pnpm test:contract
pnpm test:integration -- schema reproducibility
```

Validate:

- both JSON Schemas and their positive/negative fixtures;
- unknown fields, unsupported newer versions and each stepwise migration;
- heading hierarchy, page boundary, alias, resource and manifest cross-references;
- a rebuild from the same Markdown, `book.yaml`, originals and compiler version yields
  matching manifest, page, resource and search-content hashes.

Rebuilding an existing published version reuses its frozen `version_id` and manifest
`created_at` from `version.json`, and the entire canonical manifest hash must match. A new
publication has a new identity; its page, resource and search-content hash set must still
match when authoritative content is unchanged. No unexplained nondeterminism is accepted.

## 8. Performance gate

On the documented reference host:

Register the administrator-supplied real fixtures without copying them into Git:

```bash
pnpm fixtures:verify-real --dir "$PWD/tests/fixtures/mineru/real"
```

The verifier checks each opaque manifest entry's size and SHA-256. Missing real fixtures may
produce an explicit skip in ordinary CI, but final acceptance must run all registered real
fixtures in addition to the synthetic stress fixture. The manifest also records that the
user designated each sample for local testing; the ZIPs are never redistributed, committed,
or uploaded to public CI.

```bash
pnpm benchmark:reference \
  --real-dir "$PWD/tests/fixtures/mineru/real" \
  --retain-dir "$MIRAWIND_BENCHMARK_DIR" \
  --output-json "$PWD/docs/audits/m1-performance-results.json" \
  --output-markdown "$PWD/docs/audits/m1-performance-report.md"
```

`benchmark:reference` drives the production Web and worker artifacts and composes the
`benchmark:build`, `benchmark:read` and `benchmark:search` modules for every registered real
fixture plus the generated stress fixture. `MIRAWIND_BENCHMARK_DIR` must be an empty or
disposable absolute private directory with enough space for all retained data roots.

Record:

- upload size, extracted bytes and entry count;
- build wall time and peak worker/child memory;
- output and FTS index size plus FTS build time;
- uncached-origin public read p50/p95/p99 while idle and while building;
- normal and short-query search p50/p95/p99.
- interrupted/resumed multi-GiB sparse original-file byte identity without allocating an
  equivalent Git fixture.

Pass criteria are read p95 at or below 300 ms and supported search p95 below 1 second.
Background build must not make the current published page unavailable or move compilation
work into its request trace.

## 9. Full verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm test:contract
```

M1 is not complete until these commands pass, the benchmark report is captured, migrations
and recovery are exercised on a copy of representative data, and Spec Kit analysis has no
unmitigated CRITICAL finding.
