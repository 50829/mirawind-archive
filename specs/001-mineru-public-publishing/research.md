# Research: MinerU Public Publishing

- Date: 2026-07-24
- Scope: implementation choices left open by the approved M1 product decisions
- Source policy: official documentation, specifications and upstream repositories

Exact dependency versions below are planning snapshots, not floating install instructions.
Implementation must commit a lockfile, runtime version file and container image digest, and
must retest before any dependency upgrade.

## R-001 — Runtime and Astro deployment

**Decision**: Use Node.js 24 LTS and Astro 7's official Node adapter in standalone server
mode with `output: "server"`. Use Astro pages/endpoints for HTTP and React only for
interactive islands.

**Rationale**: Node's release policy recommends Active or Maintenance LTS for production;
Node 24 is the current LTS line while Node 26 is still Current. Astro's official standalone
adapter produces a self-starting Node server for pages and API endpoints without adding a
second HTTP framework. This directly matches the one-Web-process constraint.

**Operational rules**:

- Pin Node major 24 and a tested patch in the image; do not deploy floating `node:latest`.
- Bind Node to loopback/private container networking and let Caddy terminate HTTPS.
- Configure exact allowed host/origin values. Runtime environment is injected explicitly.
- Only Astro's hashed site JS/CSS/fonts may use its automatic public immutable cache.
  Book files never enter `public/` or `dist/client/`.

**Alternatives rejected**:

- Node 26 Current: not yet LTS.
- Astro Node middleware mode plus Express/Fastify: no custom HTTP server requirement.
- Separate frontend and API services: duplicates routing/auth boundaries without scale need.

**Evidence**: [Node release schedule](https://nodejs.org/en/about/previous-releases),
[Astro 7 release](https://astro.build/blog/astro-7/),
[Astro Node adapter](https://docs.astro.build/en/guides/integrations-guide/node/),
[Astro React integration](https://docs.astro.build/en/guides/integrations-guide/react/).

## R-002 — Authentication, Passkeys and proxy trust

**Decision**: Use the current locked Better Auth stable line (planning snapshot: 1.6) with
`@better-auth/passkey`, its built-in `better-sqlite3` adapter, an Astro catch-all handler and
Astro middleware session resolution. Keep signup disabled in the HTTP instance and use a
non-HTTP setup-only instance for the offline CLI.

**Rationale**: Better Auth officially supports Astro's Request/Response API, SQLite,
database sessions, email/password and WebAuthn/Passkeys. This avoids implementing credential
protocols. A sole `installation.admin_user_id` check is simpler than the multi-role Admin
plugin.

**Security rules**:

- Lock Better Auth core, plugin and CLI to one tested combination; generate and review auth
  schema changes with the locked CLI, never `npx ...@latest migrate`.
- Set exact `baseURL`, trusted origins, Passkey origin and RP ID before registering a real
  credential. Production requires HTTPS; only localhost development is exempt.
- Keep CSRF/origin checks and Astro host checks enabled. Do not trust dynamically forwarded
  host headers to derive the origin.
- Caddy is the sole trusted proxy; the Node origin is not publicly reachable. Only a
  proxy-overwritten single-value client-IP header may influence logging/rate limiting.
- Store a 32-byte-or-greater high-entropy auth secret outside the repository.
- Persist Better Auth HTTP rate limits in SQLite. Server-side CLI calls are protected by
  host access and the maintenance lock, not HTTP rate limiting.
- Configure `emailAndPassword.minPasswordLength=16`,
  `emailAndPassword.maxPasswordLength=128`, and `session.freshAge=300`. Passkey add, rename,
  and delete hooks require that server-side freshness; a database constraint enforces at
  most ten credentials even across concurrent registration attempts. Deleting the final
  Passkey additionally verifies the fallback password during that operation. Complete
  recovery revokes sessions and removes all Passkeys.

**Alternatives rejected**:

- `node:sqlite`: Better Auth still describes it as release-candidate quality for this use.
- Drizzle auth adapter: adds schema/migration coupling without benefiting the direct-SQL
  business model.
- Pre-authentication Passkey registration: expands the unauthenticated protocol surface.
- Broad parent-domain RP ID or wildcard origins: increases credential/origin exposure.

**Evidence**: [Better Auth Astro integration](https://better-auth.com/docs/integrations/astro),
[SQLite adapter](https://better-auth.com/docs/adapters/sqlite),
[Passkey plugin](https://better-auth.com/docs/plugins/passkey),
[session freshness](https://better-auth.com/docs/concepts/session-management#session-freshness),
[password length options](https://better-auth.com/docs/reference/options#emailandpassword),
[Better Auth security](https://better-auth.com/docs/reference/security),
[rate limiting](https://better-auth.com/docs/concepts/rate-limit),
[WebAuthn RP ID rules](https://www.w3.org/TR/webauthn-3/#sctn-rp-id),
[Astro security configuration](https://docs.astro.build/en/reference/configuration-reference/#security).

## R-003 — SQLite runtime floor and connection policy

**Decision**: Use `better-sqlite3` and fail startup unless the actually linked SQLite is at
least 3.51.3, FTS5 is compiled in, and `journal_mode` reads back as WAL. The planning
snapshot `better-sqlite3` 12.10 embeds a newer qualifying SQLite, but runtime checks remain
mandatory.

**Rationale**: SQLite 3.51.3 fixed a WAL-reset corruption defect affecting older WAL
versions in a multi-connection/multi-process pattern like the Web + worker design. Package
names and system versions do not prove which SQLite the native module actually links.
`better-sqlite3` offers reviewed prepared statements, explicit transactions, PRAGMAs and a
safe backup API.

**Connection policy**:

- Web and worker each own one long-lived connection; the job child never opens SQLite.
- Both enable `foreign_keys`, `trusted_schema=OFF` and `synchronous=FULL`.
- Web lock timeout is initially 250 ms; worker timeout is initially 5 s. Both are measured
  and tuned, never silently expanded.
- Known read-then-write operations begin `IMMEDIATE`; all transactions are synchronous,
  short and contain no filesystem I/O, parser work or process waits.
- Retry `SQLITE_BUSY` only for explicitly idempotent operations, with a small bounded
  backoff; otherwise roll back the whole business operation.
- Disable per-connection auto-checkpoint. The worker is the normal `PASSIVE` checkpointer
  and reports WAL size/remaining pages. `RESTART`/`TRUNCATE` are maintenance-only.
- Backups use SQLite's online backup API, never a blind copy of only the main DB file.
- Run `quick_check` periodically and a full `integrity_check` during maintenance.

**Alternatives rejected**:

- Older SQLite/WAL: known corruption exposure.
- Default 5-second Web busy timeout: the synchronous driver could block Astro's event loop.
- Checkpoint on whichever request crosses the default threshold: moves fsync latency into a
  public request unpredictably.

**Evidence**: [SQLite WAL-reset defect and fix](https://www.sqlite.org/wal.html#the_wal_reset_bug),
[SQLite WAL concurrency](https://www.sqlite.org/wal.html#concurrency),
[SQLite transactions](https://www.sqlite.org/lang_transaction.html),
[`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3),
[`trusted_schema`](https://www.sqlite.org/pragma.html#pragma_trusted_schema).

## R-004 — Business schema and migrations

**Decision**: Keep reviewed, checksummed SQL files as the database schema authority and use a
thin prepared-statement repository layer. A pre-start CLI applies migrations while Web and
worker are stopped. Better Auth's locked tooling produces its own reviewed schema changes.

**Rationale**: M1 relies on FTS5 virtual tables, PRAGMAs, explicit `BEGIN IMMEDIATE`,
version-level bulk indexing and crash-boundary tests. These all require native SQL even when
an ORM is present. Direct SQL avoids parallel TypeScript and SQL schema authorities.

**Rules**:

- `schema_migrations(version, checksum, applied_at)` records immutable migration history.
- A committed migration file is never edited; checksum mismatch stops startup.
- Transactional changes run in one transaction. Non-transactional PRAGMA/journal steps are
  isolated and read-back verified.
- Every migration includes an old-version fixture, forward migration test, FTS/constraint
  validation and backup/restore exercise.

**Alternative rejected**: Drizzle for M1 schema/migrations. It still requires custom SQL for
these features and would add a second representation. A future typed query layer may be
reconsidered if ordinary CRUD maintenance becomes material.

**Evidence**: [Drizzle custom SQL migrations](https://orm.drizzle.team/docs/kit-custom-migrations),
[`better-sqlite3` API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md).

## R-005 — Durable worker and terminable job execution

**Decision**: The Web process enqueues short SQLite records. One worker leases work and
spawns a same-codebase Node child with `fork()` or `spawn(process.execPath, ..., {
shell:false })`. Frozen task input and progress use IPC; the child writes only its unique
staging directory and returns a result for parent verification.

**Rationale**: SQLite lease state survives process/host restarts, while a real child process
can be forcibly terminated at the 30-minute limit without killing Web. Keeping the child
away from SQLite prevents long or accidental cross-boundary transactions.

**Termination rules**:

1. Cancellation/timeout sends an AbortSignal or `SIGTERM`.
2. After a fixed 10-second grace period, send `SIGKILL` to the whole task process group.
3. Mark the job terminal only after the child's `close` event confirms exit; `.killed` only
   means a signal was sent.
4. The child must not invoke a shell or create descendants. The service manager/container
   must kill the whole process group/cgroup on service shutdown.

**Alternative rejected**: in-process async background work. It shares Web failure/memory
boundaries and loses durable state on restart. Redis/BullMQ is constitutionally unnecessary.

**Evidence**: [Node child processes](https://nodejs.org/api/child_process.html),
[SQLite WAL busy/recovery behavior](https://www.sqlite.org/wal.html#sometimes_queries_return_sqlite_busy_in_wal_mode).

## R-006 — ZIP reader and actual expansion accounting

**Decision**: Use locked `@zip.js/zip.js` (planning snapshot 2.8.34) in the job child with
strict ambiguity/overlap/header/CRC checks, no Web Workers and the task AbortSignal. Read the
durable ZIP twice: first stream each entry's raw compressed bytes to a counting sink, then
stream actual decompressed bytes into a limit-enforcing writer.

**Rationale**: zip.js exposes lazy entry generation, streaming extraction, AbortSignal,
strict local/central-header checks, overlap checks, CRC verification and pass-through raw
compressed data. The raw pass establishes the actual compressed denominator required by the
approved 200:1 rule instead of trusting central-directory metadata. The second pass enforces
actual decompressed entry and package totals.

**Required application checks**:

- Count actual entries; accept only methods 0 and 8, disk 0, unencrypted regular files and
  directories.
- Reject Unix link/special-file modes and link semantics in extra fields; remove executable
  permission rather than treating special types as files.
- Normalize `\` to `/`, reject NUL, absolute/drive/UNC, empty, `.` and `..` components;
  normalize NFC and reject original/NFC/file-directory collisions.
- Enforce depth, component-byte and relative-path-byte limits before filesystem writes.
- Create private staging and files with exclusive/no-follow semantics; verify each parent
  remains under the staging root.
- During raw pass, require counted compressed bytes to match the parsed entry size.
- During extraction, abort immediately on entry/package bytes, expansion ratio, elapsed time
  or cancellation; verify final sizes and CRC, unlink partial output, then clean the entire
  staging root on any failure.

The extra raw pass reads at most the approved 2 GiB compressed package without decompressing
it and buys evidence for the exact security rule.

**Alternative rejected**: `yauzl` as the default. It supports lazy/raw streams and rejects
some unsafe formats, but its upstream explicitly omits CRC checking and leaves more
central/local-header and overlap validation to application code.

**Evidence**: [zip.js repository](https://github.com/gildas-lormeau/zip.js),
[ZipReader API](https://gildas-lormeau.github.io/zip.js/api/classes/ZipReader.html),
[entry streaming options](https://gildas-lormeau.github.io/zip.js/api/interfaces/EntryGetDataOptions.html),
[entry metadata](https://gildas-lormeau.github.io/zip.js/api/interfaces/FileEntry.html),
[`yauzl` design/limitations](https://github.com/thejoshwolfe/yauzl).

## R-007 — Markdown, raw HTML, formulas and code

**Decision**: Use the unified ecosystem (planning snapshots: unified 11, remark-parse 11,
remark-gfm 4, remark-math 6, remark-rehype 11, rehype-raw 7, rehype-sanitize 6,
rehype-katex 7 and rehype-stringify 10), KaTeX and Shiki 4 with a deliberately ordered
pipeline:

```text
fatal UTF-8 decode
→ remark parse/GFM/math
→ app mdast: positions, block IDs, config overrides, resource mapping
→ remark-rehype with raw HTML enabled
→ rehype-raw
→ strict rehype-sanitize input allowlist
→ trusted KaTeX and approved-language Shiki transforms
→ final invariant check
→ stringify
```

**Rationale**: `rehype-raw` converts untrusted embedded HTML into inspectable HAST;
sanitization must then run before trusted renderers produce their richer output. Only
math/language marker classes needed by those renderers are admitted from input. No later
custom plugin may interpret user text as HTML.

**Formula rules**: KaTeX uses `trust:false`, finite `maxSize`, finite `maxExpand` and
`throwOnError:true`. On a parse error, the compiler creates a text node containing the
original notation and a safe diagnostic code; it never concatenates error input into HTML.

**Highlight rules**: Load only an approved language/theme set with the Shiki core API;
unknown languages remain escaped plain text. Use Shiki's `transformerStyleToClass` and emit
deterministic versioned CSS instead of token `style` attributes.

**CSP note**: Astro's built-in CSP does not directly support default Shiki inline output.
The class transformer removes that Shiki conflict, but the production KaTeX/reader corpus
must still pass a production CSP integration test before enabling Astro CSP. M1 does not
claim CSP protection until that test passes; sanitization, origin checks and the other
required security headers remain mandatory.

**Alternatives rejected**:

- Trusting raw HTML or sanitizing before raw HTML is parsed: unsafe nodes can evade the
  allowlist.
- Runtime KaTeX/Shiki in reader requests: violates request-path constraints.
- Guessing unknown code languages: increases grammar/memory surface and nondeterminism.

**Evidence**: [remark-rehype raw HTML guidance](https://github.com/remarkjs/remark-rehype#example-supporting-html-in-markdown-properly),
[rehype-sanitize](https://github.com/rehypejs/rehype-sanitize),
[KaTeX security](https://katex.org/docs/security),
[KaTeX options](https://katex.org/docs/options),
[Shiki rehype integration](https://shiki.style/packages/rehype),
[Shiki style-to-class transformer](https://shiki.style/packages/transformers),
[Astro CSP limitation](https://docs.astro.build/en/reference/configuration-reference/#securitycsp).

## R-008 — Image validation and rendering

**Decision**: Use locked Sharp/libvips (planning snapshot Sharp 0.35) inside the job child.
Accept a narrow browser-safe M1 raster set: JPEG, PNG, WebP and single-frame GIF. Reject SVG,
animated/multipage images and unsupported formats with a safe diagnostic unless a later
decision expands the contract.

**Rationale**: Sharp provides decoder pixel limits, metadata and bounded sequential
processing. However, its documentation notes that metadata inspection does not decode image
pixels and pixel limits assume trustworthy metadata. Therefore the compiler must check magic,
format, dimensions and declared pixels, then force a real bounded decode/derived operation
inside the job resource boundary before publishing.

**Baseline options**: `unlimited:false`, `failOn:"warning"`,
`limitInputPixels:100_000_000`, `sequentialRead:true`, one page/frame. Independently enforce
width/height at 32,768 and actual output/resource byte limits.

**Alternatives rejected**:

- Publishing imported SVG directly: active/external content surface is unnecessary in M1.
- Metadata-only image checks: do not prove decoder work remains within approved limits.
- Browser-time conversion: shifts work and parser risk onto reader requests.

**Evidence**: [Sharp constructor/input controls](https://sharp.pixelplumbing.com/api-constructor/),
[Sharp input metadata](https://sharp.pixelplumbing.com/api-input/).

## R-009 — YAML and JSON Schema

**Decision**: Parse `book.yaml` with locked `yaml` 2 in strict YAML 1.2 core mode, one
document only, unique keys, merge keys disabled, known-tag resolution disabled and aliases
forbidden. Recursively reject any value outside the JSON data model. Validate with Ajv 8's
draft-2020-12 class in strict mode plus `ajv-formats`, without coercion, default insertion,
unknown-field removal or other input mutation.

**Rationale**: `book.yaml` is portable authority, so duplicate keys, aliases, implicit
custom types and validator mutation would make meaning non-obvious. JSON Schema handles
shape; application validators still enforce heading/resource/reference semantics.

**Alternative rejected**: permissive YAML parsing followed by cleanup. It changes input
meaning and can hide unsupported fields rather than rejecting them.

**Evidence**: [`yaml` options and alias controls](https://eemeli.org/yaml/),
[Ajv draft 2020-12](https://ajv.js.org/json-schema.html).

## R-010 — Search

**Decision**: Retain the approved FTS5 trigram `detail=full` design. At startup, construct a
temporary trigram FTS table/query as a capability smoke test in addition to checking
`ENABLE_FTS5`.

**Rationale**: Trigram provides Unicode continuous-substring behavior for queries of three
or more code points; FTS5 explicitly cannot match shorter trigram queries. Keeping
`detail=full` supports phrases longer than one trigram. The small version-scoped short table
contains only title, author and heading strings.

**Rules**:

- Index and query use identical rendered-text NFC/newline normalization.
- Encode user input as one FTS5 double-quoted literal phrase *and* bind it as a SQL
  parameter.
- Join every query to book visibility and `current_version_id`.
- Limit one/two-character scans and result counts; never body `LIKE`.

**Alternatives rejected**: `unicode61` for Chinese body search, a native tokenizer extension,
body unigram/bigram tables and an external search service.

**Evidence**: [SQLite FTS5 trigram tokenizer](https://www.sqlite.org/fts5.html#the_trigram_tokenizer),
[project PoC](../../docs/research/sqlite-fts5-chinese-short-query.md).

## R-011 — Testing and performance evidence

**Decision**: Use Vitest for pure/component/repository tests and benchmarks, real temporary
SQLite files and real processes for integration/recovery tests, and Playwright against the
production build with Web + worker for end-to-end journeys.

**Rationale**: Mocking SQLite, filesystem rename/fsync or child termination cannot establish
the required atomicity and recovery behavior. Browser tests are needed for session cookies,
Passkeys, headers, Range and anonymous/private route behavior.

**Rules**:

- Shared-database browser suites run with one test worker, or each test worker receives an
  entirely separate data root.
- The administrator supplies two or three real, several-hundred-page MinerU ZIPs during the
  test stage. Store them outside Git; register only opaque ID, MinerU version, size and
  SHA-256. Ordinary CI explicitly skips real-fixture tests when absent, but final
  compatibility and performance reports require all registered samples.
- Crash tests send real `SIGKILL` at named boundaries and restart processes.
- Performance evidence records hardware, Node/SQLite/compiler versions, fixture hashes,
  warmup, concurrency and raw samples. Test idle and concurrent-build profiles.
- HTTP p95 measurement runs against a production server, not a browser/CDN cache.

**Evidence**: [Astro testing](https://docs.astro.build/en/guides/testing/),
[Playwright Web servers](https://playwright.dev/docs/test-webserver),
[Vitest benchmarking](https://main.vitest.dev/guide/benchmarking),
[Node performance hooks](https://nodejs.org/api/perf_hooks.html).

## R-012 — Structured logging

**Decision**: Use Pino JSON logging in Web, worker and job child with fixed child bindings
for service/request/job/book/version/phase/attempt and static redaction rules.

**Rationale**: Pino supplies maintained structured logging and redaction without putting
formatting/transports on the request path. journald/container infrastructure owns rotation.

**Prohibited data**: cookies, authorization headers, passwords, credential/Passkey material,
recovery secrets, full Markdown, private body content and raw unsafe ZIP names. Never attach
unfiltered request/user/error objects or let user input define redaction paths.

**Evidence**: [Pino API and redaction](https://github.com/pinojs/pino/blob/main/docs/api.md),
[Pino project](https://github.com/pinojs/pino).
