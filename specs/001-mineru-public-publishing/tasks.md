# Tasks: MinerU Public Publishing

**Input**: Design documents from `/specs/001-mineru-public-publishing/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`,
`contracts/openapi.yaml`, `contracts/admin-cli.md`, `quickstart.md`

**Tests**: Constitution-critical evidence is mandatory. Within every user-story phase, write
the listed tests first and confirm they fail for the intended missing behavior before
implementing that behavior.

**Organization**: Tasks are grouped by user story. Every task names the concrete file or
directory it changes. `[P]` means the task can proceed in parallel with other marked tasks
after its phase prerequisites are satisfied.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the pinned TypeScript/Astro project, verification tools and deployable
process entry points.

- [X] T001 Initialize Git plus the Node.js 24/pnpm/Astro 7 project, exact runtime engines, scripts and locked production/dev dependencies in `.git/`, `package.json`, `pnpm-lock.yaml`, `.node-version`, and `pnpm-workspace.yaml`
- [X] T002 [P] Configure strict TypeScript, Astro Node standalone output, React integration, import aliases, allowed hosts and server build boundaries in `tsconfig.json`, `astro.config.mjs`, and `src/env.d.ts`
- [X] T003 [P] Configure ESLint, Prettier, Conventional Commits/commitlint, a repository-managed `commit-msg` hook, contribution/provenance rules and repository ignores without ignoring specification or migration evidence in `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.gitignore`, `commitlint.config.mjs`, `.githooks/commit-msg`, `CONTRIBUTING.md`, and `docs/third-party/code-provenance.md`
- [X] T004 [P] Configure Vitest projects, Playwright production-Web setup and coverage thresholds in `vitest.config.ts`, `playwright.config.ts`, and `tests/helpers/global-setup.ts`
- [X] T005 [P] Create the Web, worker, job-child and CLI entry-point boundaries in `src/worker/index.ts`, `src/worker/job-child.ts`, `src/cli/index.ts`, and `src/pages/index.astro`
- [X] T006 [P] Define validated non-secret environment examples and secret-handling guidance in `.env.example` and `docs/operations/configuration.md`
- [X] T007 [P] Define the production image, one-Web/one-worker Compose topology, persistent volume, health checks and Caddy-only origin exposure in `docker/Dockerfile`, `docker/compose.yaml`, and `docker/Caddyfile`
- [X] T008 [P] Add Conventional Commit range/final-PR-title validation plus lint, typecheck, unit, integration, contract and production-build jobs using frozen installs in `.github/workflows/commitlint.yml` and `.github/workflows/ci.yml`
- [X] T009 Wire the canonical `docs/schemas/book.schema.json` and `docs/schemas/document-manifest.schema.json` into the server build without duplicating schema authority in `src/schemas/registry.ts` and `scripts/copy-runtime-schemas.mjs`

**Checkpoint**: The empty Astro Web process, worker, CLI and test runners build from a frozen
lockfile on Node.js 24.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Implement shared configuration, storage, database, authentication, error,
logging and durable-job infrastructure required by every user story.

**⚠️ CRITICAL**: No user-story implementation begins until this phase passes.

### Foundational evidence first

- [X] T010 [P] Add failing environment validation tests for HTTPS production origin, localhost exception, exact RP ID/origin, data-root safety and secret entropy in `tests/unit/config/environment.test.ts`
- [X] T011 [P] Add failing SQLite capability, WAL-reset version-floor, PRAGMA, busy-bound and FTS5 trigram smoke tests in `tests/integration/storage/sqlite-capabilities.test.ts`
- [X] T012 [P] Add failing checksummed migration, immutable-history, old-fixture upgrade and backup/restore tests in `tests/integration/storage/migrations.test.ts`
- [X] T013 [P] Add failing storage-root, same-filesystem, exclusive-create, no-follow, atomic-write, fsync and relative-path containment tests in `tests/integration/storage/filesystem.test.ts`
- [X] T014 [P] Add failing authentication tests for disabled signup, session middleware, sole-admin enforcement, 299/300/301-second freshness boundaries, final-Passkey password verification and non-cacheable auth failures in `tests/integration/auth/auth-boundary.test.ts`
- [X] T015 [P] Add failing offline CLI contract tests for 16–128-character TTY-only passwords, one-time bootstrap, full recovery, maintenance locking, session revocation and Passkey deletion in `tests/integration/auth/admin-cli.test.ts`
- [X] T016 [P] Add failing durable-job repository tests for atomic single claim, immutable attempts, 10-second heartbeat, 60-second expiry and global build concurrency one in `tests/integration/recovery/job-repository.test.ts`
- [X] T017 [P] Add failing safe-error, request-ID, origin-check, cache-policy and log-redaction tests in `tests/unit/http/response-policy.test.ts` and `tests/unit/observability/redaction.test.ts`

### Foundational implementation

- [X] T018 Implement typed environment parsing and production security invariants in `src/config/environment.ts`
- [X] T019 [P] Implement opaque ID generation, UTC time, stable error codes and bounded diagnostic primitives in `src/domain/ids.ts`, `src/domain/time.ts`, and `src/domain/errors.ts`
- [X] T020 [P] Implement Pino Web/worker/child loggers with fixed bindings and static credential/content/path redaction in `src/observability/logger.ts`
- [X] T021 Implement persistent layout creation, permission verification, same-filesystem checks, atomic file writes and safe relative-path resolution in `src/storage/layout.ts`, `src/storage/atomic-file.ts`, and `src/storage/path-resolver.ts`
- [X] T022 Implement separate Web/worker `better-sqlite3` connections with linked SQLite >=3.51.3, WAL/FTS5 read-back, `foreign_keys=ON`, `trusted_schema=OFF`, `synchronous=FULL`, disabled auto-checkpoint and 250 ms/5 s busy bounds in `src/db/connection.ts` and `src/db/capabilities.ts`
- [X] T023 Create the checksummed M1 business schema for installation, books, sources, configs, previews, originals, imports, candidates, versions, jobs, short search and audit records plus FTS5 trigram in `src/db/migrations/0001_m1_core.sql`
- [X] T024 Implement the offline checksummed migration runner, schema lock and backup hook in `src/db/migrate.ts`, `src/db/migration-manifest.ts`, and `src/cli/commands/db-migrate.ts`
- [X] T025 Generate and commit the locked Better Auth core, Passkey and database-rate-limit tables plus a database-enforced ten-Passkey ceiling as a reviewed migration in `src/db/migrations/0002_better_auth.sql`
- [X] T026 Configure the HTTP and setup-only Better Auth instances with disabled public signup, 16–128-character password policy, 300-second session freshness, Passkey origin/RP settings and persistent rate limits in `src/auth/server.ts` and `src/auth/setup-server.ts`
- [X] T027 Mount Better Auth and resolve request-local sessions without exposing dynamic host trust in `src/pages/api/auth/[...all].ts`, `src/middleware.ts`, and `src/auth/session.ts`
- [X] T028 Implement sole-administrator, server-timed 300-second reauthentication and resource-visibility guards, including indistinguishable anonymous private/missing results in `src/http/authorization/admin-guard.ts`, `src/http/authorization/book-guard.ts`, and `src/http/authorization/reauth-guard.ts`
- [X] T029 Implement exclusive maintenance locking and service-running detection for offline commands in `src/storage/maintenance-lock.ts`
- [X] T030 Implement 16–128-character TTY-only `admin bootstrap` and `admin recover` using Better Auth APIs and atomic audit records in `src/cli/commands/admin-bootstrap.ts`, `src/cli/commands/admin-recover.ts`, and `src/cli/index.ts`
- [ ] T031 [P] Implement Passkey-first login with password fallback and no registration/recovery Web surface in `src/pages/login.astro` and `src/components/auth/LoginPanel.tsx`
- [ ] T032 Implement `contracts/passkey-policy.md` with Better Auth mutation hooks, database-enforced ten-key limit, 300-second freshness and password-verified final-key deletion in `src/auth/passkey-policy.ts`, `src/pages/api/manage/security/passkeys/[passkeyId]/delete-final.ts`, `src/pages/manage/security.astro`, and `src/components/auth/PasskeyManager.tsx`
- [X] T033 Implement short `BEGIN IMMEDIATE` transaction helpers and narrow repositories for installation and audit events in `src/db/transaction/immediate.ts`, `src/db/repositories/installation.ts`, and `src/db/repositories/audit-events.ts`
- [ ] T034 Implement durable job creation, idempotency, claim, heartbeat, cancellation request, terminal completion and retry-chain repositories in `src/db/repositories/jobs.ts` and `src/jobs/state-machine.ts`
- [ ] T035 Implement the worker poll loop and IPC-only job-child protocol without child SQLite access or shell invocation in `src/worker/index.ts`, `src/worker/child-runner.ts`, and `src/worker/protocol.ts`
- [ ] T036 Implement request IDs, JSON/HTML safe errors, exact-origin checks and centralized cache/indexing policy builders in `src/http/request-context.ts`, `src/http/errors/responses.ts`, `src/http/origin.ts`, and `src/http/cache/policies.ts`
- [ ] T037 [P] Build isolated temporary data-root, real SQLite, Web/worker process and HTTP test helpers in `tests/helpers/data-root.ts`, `tests/helpers/database.ts`, `tests/helpers/processes.ts`, and `tests/helpers/http.ts`
- [ ] T038 [P] Add minimized Cloud/CLI/generic/ambiguous/multi-book fixtures plus a non-redistributable Git-external usage-scope manifest and size/SHA-256 verifier for the two or three real several-hundred-page MinerU ZIPs supplied during testing in `tests/fixtures/mineru/README.md`, `tests/fixtures/mineru/fixtures.json`, `tests/fixtures/mineru/real-fixtures.example.json`, and `scripts/fixtures/verify-real-mineru.ts`
- [ ] T039 [P] Implement deterministic hostile-ZIP and large-book fixture generators without committing multi-gigabyte binaries in `scripts/fixtures/build-hostile-zips.ts`, `scripts/fixtures/build-stress-book.ts`, and `tests/fixtures/hostile-archives/README.md`

**Checkpoint**: Authentication, persistent storage, migrations, safe HTTP behavior and a
single durable worker queue pass their evidence tests. User-story work may begin.

---

## Phase 3: User Story 1 — Import and prepare one book (Priority: P1) 🎯 Technical MVP

**Goal**: The sole administrator can stream one MinerU ZIP, receive safe candidate evidence,
confirm a generic main Markdown when needed, and reach a private revision-pinned draft
preview with durable Markdown, original ZIP and `book.yaml`.

**Independent Test**: From an empty bootstrapped installation, import each representative
candidate class. High-confidence input reaches preview automatically, generic single
Markdown pauses for confirmation, ambiguous/multi-book input rejects, hostile input leaves
no readable draft, and every anonymous draft/diagnostic/resource request matches a missing
non-cacheable response.

**Requirements**: FR-004–FR-019, FR-032–FR-034, FR-040; NFR-001, NFR-005–NFR-007.

### Evidence tests for User Story 1

- [ ] T040 [P] [US1] Add failing OpenAPI contract tests for import creation/status/confirmation, draft retrieval/update and revision-pinned preview routes in `tests/contract/import-preview.contract.test.ts`
- [ ] T041 [P] [US1] Add failing archive path tests for absolute/drive/UNC/traversal/NUL/empty/dot paths, Windows separators, NFC collisions, duplicates and file-directory prefix conflicts in `tests/integration/archive/path-security.test.ts`
- [ ] T042 [P] [US1] Add failing archive format tests for malformed headers, local/central ambiguity, overlaps, CRC, encryption, multi-disk, methods other than 0/8, links and special files in `tests/integration/archive/format-security.test.ts`
- [ ] T043 [P] [US1] Add failing actual-stream limit tests for 2 GiB upload/entry, 8 GiB package, 20,000 entries, 64 MiB ratio threshold, 200:1 entry/package ratio, depth/path limits, cancellation and cleanup in `tests/integration/archive/resource-limits.test.ts`
- [ ] T044 [P] [US1] Add failing main-document selection tests for nested Cloud/CLI, generic confirmation, missing resources, ambiguous candidates and multi-book rejection in `tests/integration/compiler/candidate-selection.test.ts`
- [ ] T045 [P] [US1] Add failing Markdown tests for fatal UTF-8, source positions, opaque block IDs, NFC visible text, GFM/math, semantic containers, resource-base containment and malicious raw HTML/URLs in `tests/integration/compiler/document-parse.test.ts`
- [ ] T046 [P] [US1] Add failing raster tests for magic/format mismatch, corrupt decode, 100M pixels, 32,768-pixel sides, animation/multipage/SVG rejection and bounded real decode in `tests/integration/compiler/image-security.test.ts`
- [ ] T047 [P] [US1] Add failing strict YAML/JSON Schema tests for aliases, duplicate keys, custom tags, merge keys, unknown fields, unsupported newer versions and non-mutating validation in `tests/contract/book-schema.test.ts`
- [ ] T048 [P] [US1] Add failing authorization/cache tests proving preview pages/assets, candidates, jobs, sources and diagnostics are administrator-only and anonymous private/missing responses match in `tests/integration/auth/draft-visibility.test.ts`
- [ ] T049 [US1] Add a failing browser journey covering high-confidence import, generic confirmation, ambiguous rejection, draft preview and source-Markdown immutability in `tests/e2e/import-preview.spec.ts`

### Implementation for User Story 1

- [ ] T050 [P] [US1] Implement import, candidate, source-snapshot, config-revision, original-file and draft-preview repositories in `src/db/repositories/imports.ts`, `src/db/repositories/sources.ts`, and `src/db/repositories/drafts.ts`
- [ ] T051 [US1] Implement authenticated multipart upload streaming to exclusive `.part` files with actual byte counting, SHA-256, fsync, durable rename and idempotent job enqueue in `src/services/import-upload.ts`
- [ ] T052 [P] [US1] Implement ZIP entry-name decoding, POSIX/NFC normalization, collision detection and byte/depth limit policy in `src/compiler/archive/path-policy.ts`
- [ ] T053 [US1] Implement strict zip.js enumeration and raw compressed-byte pass with ambiguity, overlap, CRC, method, disk, encryption and Unix-type validation in `src/compiler/archive/zip-reader.ts`
- [ ] T054 [US1] Implement exclusive no-follow streaming extraction with actual entry/package byte and expansion-ratio enforcement, cancellation, timeout counters and whole-staging cleanup in `src/compiler/archive/extractor.ts`
- [ ] T055 [P] [US1] Implement recursive Markdown candidate parsing, resource-integrity evidence, high/generic/ambiguous scoring and one-book bundle detection in `src/compiler/document/candidate-discovery.ts`
- [ ] T056 [US1] Implement the `analyze_import` worker handler and durable candidate state transitions without logging unsafe raw paths in `src/jobs/handlers/analyze-import.ts`
- [ ] T057 [P] [US1] Implement strict YAML 1.2 JSON-only parsing, Ajv 2020 validation and explicit supported-version dispatch in `src/schemas/book-config.ts` and `src/schemas/versioning.ts`
- [ ] T058 [US1] Implement immutable accepted source/original snapshot creation, reference-root pruning and rollback cleanup in `src/services/source-snapshot.ts`
- [ ] T059 [P] [US1] Implement the ordered remark/GFM/math parser with current source spans and transient AST types in `src/compiler/document/parser.ts` and `src/compiler/document/types.ts`
- [ ] T060 [US1] Implement block normalization, random stable IDs, heading extraction, NFC/newline visible-text normalization and versioned fingerprints in `src/compiler/document/normalize.ts`
- [ ] T061 [P] [US1] Implement contained local-resource resolution, missing/cross-root diagnostics and opaque resource mapping in `src/compiler/resources/resolver.ts`
- [ ] T062 [P] [US1] Implement bounded Sharp raster inspection and forced single-frame JPEG/PNG/WebP/GIF decode in `src/compiler/resources/images.ts`
- [ ] T063 [US1] Implement default TOC inclusion, four-role, continuous-level and heading-only page-boundary proposals without changing source order in `src/compiler/document/structure-proposal.ts`
- [ ] T064 [US1] Implement sanitized raw-HTML HAST conversion and the authenticated draft-preview rendering pipeline in `src/compiler/render/sanitize.ts` and `src/compiler/render/preview.ts`
- [ ] T065 [US1] Implement `prepare_draft` and `build_preview` job handlers that create immutable config revisions and revision-pinned derived preview directories in `src/jobs/handlers/prepare-draft.ts` and `src/jobs/handlers/build-preview.ts`
- [ ] T066 [US1] Implement import create/status/main-Markdown confirmation endpoints according to OpenAPI in `src/pages/api/manage/imports/index.ts`, `src/pages/api/manage/imports/[importId]/index.ts`, and `src/pages/api/manage/imports/[importId]/main-markdown.ts`
- [ ] T067 [US1] Implement draft metadata and the exact revision-pinned preview page/asset routes from OpenAPI with no-store/noindex authorization in `src/pages/api/manage/books/[bookId]/draft.ts`, `src/pages/api/manage/books/[bookId]/preview/[configRevision]/pages/[pageId].ts`, and `src/pages/api/manage/books/[bookId]/preview/[configRevision]/assets/[resourceId].ts`
- [ ] T068 [P] [US1] Implement the import uploader, durable job progress and candidate-confirmation management interface in `src/pages/manage/index.astro`, `src/components/import/ImportUploader.tsx`, and `src/components/import/CandidateReview.tsx`
- [ ] T069 [US1] Implement the structure/diagnostic preview interface with stale-revision labeling and authenticated resource URLs in `src/components/preview/StructurePreview.tsx`, `src/components/preview/DiagnosticsPanel.tsx`, and `src/pages/manage/books/[bookId]/preview.astro`

**Checkpoint**: User Story 1 passes independently. No import has become public.

---

## Phase 4: User Story 2 — Confirm structure and publish atomically (Priority: P1)

**Goal**: The administrator saves portable structure overrides, sees a current-revision
preview, and publishes only a complete immutable version whose files, manifest and search
rows all validate before a guarded atomic cutover.

**Independent Test**: Starting from a prepared draft, change every supported override and
publish. At each injected failure boundary, a reader observes one complete previous version
or the complete new version; invalid/stale work cannot cut over and source Markdown remains
unchanged.

**Requirements**: FR-011–FR-025, FR-035–FR-039; NFR-002, NFR-004, NFR-006–NFR-007.

### Evidence tests for User Story 2

- [ ] T070 [P] [US2] Add failing OpenAPI contract tests for ETag-guarded draft replacement, publish enqueue and immediate non-public visibility change in `tests/contract/config-publish.contract.test.ts`
- [ ] T071 [P] [US2] Add failing structure tests for TOC-only exclusion, display titles, continuous h1–h4 levels, role inheritance, page starts only before headings and no body reorder in `tests/integration/compiler/structure-validation.test.ts`
- [ ] T072 [P] [US2] Add failing semantic renderer tests for headings, lists, tables, figures/captions, formulas/fallback, code/plain fallback, footnotes and all eight教材 containers in `tests/integration/compiler/semantic-render.test.ts`
- [ ] T073 [P] [US2] Add failing manifest/version tests for strict schema, link/resource closure, source spans, stable IDs, hashes, complete marker and unsupported newer schema rejection in `tests/contract/document-manifest.test.ts`
- [ ] T074 [P] [US2] Add failing publication crash-matrix tests before/after fsync, rename, ready/search transaction and current-pointer transaction in `tests/integration/publication/crash-boundaries.test.ts`
- [ ] T075 [P] [US2] Add failing stale-source/config/current-version compare-and-swap and competing-publish tests in `tests/integration/publication/stale-build.test.ts`
- [ ] T076 [P] [US2] Add failing FTS row-count/ID-set validation and index-failure rollback tests in `tests/integration/publication/search-index-validation.test.ts`
- [ ] T077 [P] [US2] Add failing same-version canonical manifest and unchanged-content page/resource/search reproducibility tests in `tests/integration/compiler/reproducibility.test.ts`
- [ ] T078 [US2] Add a failing browser journey for editing every M1 override, validation errors, stale preview, publish progress, successful cutover and failed-build old-version continuity in `tests/e2e/configure-publish.spec.ts`

### Implementation for User Story 2

- [ ] T079 [P] [US2] Implement semantic config validation with offending block IDs, role inheritance, continuous levels, alias uniqueness and heading-only page splits in `src/compiler/document/validate-config.ts`
- [ ] T080 [US2] Implement atomic new `book.yaml` revision writes plus draft-pointer/preview-job transaction and strong config ETags in `src/services/config-revisions.ts`
- [ ] T081 [US2] Implement the ETag-guarded draft replacement endpoint and structured validation errors in `src/pages/api/manage/books/[bookId]/draft.ts`
- [ ] T082 [P] [US2] Implement TOC inclusion, display-title/level, four-role and starts-page controls without reorder or page-alias editing in `src/components/preview/StructureEditor.tsx`
- [ ] T083 [P] [US2] Implement trusted KaTeX pre-rendering with bounded options, source-notation fallback and safe diagnostics in `src/compiler/render/math.ts`
- [ ] T084 [P] [US2] Implement approved-language Shiki highlighting with plain-text fallback and deterministic style-to-class CSS extraction in `src/compiler/render/code.ts`
- [ ] T085 [US2] Implement the semantic HAST renderer, numbering, internal/footnote link repair and final post-render invariants in `src/compiler/render/document.ts`
- [ ] T086 [US2] Implement deterministic page splitting, version-pinned asset output and canonical `document-manifest.json` generation in `src/compiler/document/pages.ts` and `src/compiler/document/manifest.ts`
- [ ] T087 [US2] Implement canonical `version.json`, authoritative-input copies, file/hash validation, recursive fsync and same-filesystem immutable rename in `src/compiler/version-builder.ts` and `src/storage/finalize-version.ts`
- [ ] T088 [P] [US2] Implement deterministic FTS5 trigram and short-field search-row spool generation from normalized visible text in `src/compiler/search/build-spool.ts`
- [ ] T089 [US2] Implement one ready-version plus version-scoped FTS/short-field transaction with count and referential ID validation in `src/db/repositories/versions.ts` and `src/db/repositories/search-index.ts`
- [ ] T090 [P] [US2] Implement the publication policy extension interface with the M1 allow policy and no fabricated confirmation record in `src/policy/publish-policy.ts`
- [ ] T091 [US2] Implement guarded `BEGIN IMMEDIATE` cutover comparing source/config/base current version and atomically changing `current_version_id`, visibility, version states, audit and job result in `src/services/publication.ts`
- [ ] T092 [US2] Implement the `build_publish` job handler with named crash-injection points reserved for test builds in `src/jobs/handlers/build-publish.ts` and `src/jobs/crash-points.ts`
- [ ] T093 [US2] Implement publish enqueue and immediate draft/private visibility endpoints with idempotency and origin checks in `src/pages/api/manage/books/[bookId]/publish.ts` and `src/pages/api/manage/books/[bookId]/visibility.ts`
- [ ] T094 [US2] Implement publish validation/progress/failure UI while continuing to show the previous published version in `src/components/preview/PublishPanel.tsx` and `src/pages/manage/books/[bookId]/preview.astro`
- [ ] T095 [US2] Run the complete User Story 2 contract, compiler, crash, stale-build, reproducibility and browser suites and record the passing command evidence in `docs/audits/m1-us2-publication-evidence.md`

**Checkpoint**: User Stories 1 and 2 pass. A prepared book can become public atomically, but
reader search/download UX is not yet considered complete.

---

## Phase 5: User Story 3 — Read, search and download the public book (Priority: P2)

**Goal**: Anonymous readers receive fast semantic current-version pages, version-consistent
assets, safe Chinese/mixed-language search and resumable controlled original ZIP downloads.

**Independent Test**: From a fresh anonymous browser, read and navigate the published
representative book, exercise normal and short search branches, resume and hash-check the
original ZIP, then make the book private and confirm the next anonymous page/asset/search/
download requests all stop without exposing internal files.

**Requirements**: FR-016–FR-031, FR-038; NFR-001, NFR-003–NFR-004, NFR-006.

### Evidence tests for User Story 3

- [ ] T096 [P] [US3] Add failing OpenAPI contract tests for page, asset, search, full download, single Range and 416 responses in `tests/contract/public-reading.contract.test.ts`
- [ ] T097 [P] [US3] Add failing authorization/cache matrix tests for public/private/draft, current/superseded/ready/corrupt and anonymous/admin across HTML/assets/search/download in `tests/integration/auth/public-resource-matrix.test.ts`
- [ ] T098 [P] [US3] Add failing ETag/cache/SEO tests for public revalidation, private no-store, versioned private immutable assets, no-store originals and noindex hidden/download responses in `tests/integration/http/cache-indexing.test.ts`
- [ ] T099 [P] [US3] Add failing Chinese/mixed/punctuation/formula/wildcard/injection search tests for literal phrase encoding, 3+ body scope, 1–2 metadata/heading scope and current-public filtering in `tests/integration/search/book-search.test.ts`
- [ ] T100 [P] [US3] Add failing original-download tests using a generated multi-GiB sparse file for safe UTF-8/ASCII filenames, MIME/length/nosniff, ETag, suffix/open/unsatisfiable Range, interrupted/resumed byte identity, auth-before-conditional and private transition in `tests/integration/http/original-download.test.ts`
- [ ] T101 [P] [US3] Add failing semantic/accessibility tests ensuring complete DOM content, heading landmarks, table/figure captions, code labels, footnote links and no PDF.js/canvas/iframe dependency in `tests/e2e/reader-accessibility.spec.ts`
- [ ] T102 [US3] Add a failing anonymous browser journey for navigation, version-consistent assets, both search branches, resumable download and immediate private transition in `tests/e2e/public-reader.spec.ts`

### Implementation for User Story 3

- [ ] T103 [P] [US3] Implement one-read current-book/version resolution and authorization for numeric/alias book and page keys in `src/services/published-book.ts`
- [ ] T104 [US3] Implement pre-generated HTML serving with strong route/version/renderer ETags, public revalidation, private no-store and book-scoped 503 in `src/pages/read/[bookKey]/[pageKey].ts`
- [ ] T105 [US3] Implement version-pinned current or previously-published asset serving with authorization before conditional handling in `src/pages/books/[bookKey]/assets/[versionId]/[resourceId].ts`
- [ ] T106 [P] [US3] Implement `/read/{bookKey}` first-page resolution and non-stale canonical redirects in `src/pages/read/[bookKey]/index.ts`
- [ ] T107 [P] [US3] Implement the accessible fixed-top/left-TOC/body/right-outline reader shell, previous/next navigation and keyboard focus exclusions in `src/components/reader/ReaderShell.tsx`, `src/components/reader/TableOfContents.tsx`, and `src/layouts/ReaderLayout.astro`
- [ ] T108 [US3] Implement canonical/noindex metadata and response-policy application for reading, hidden, error and redirect routes in `src/http/cache/reading-response.ts` and `src/http/seo/robots.ts`
- [ ] T109 [P] [US3] Implement NFC/newline query normalization, Unicode code-point branch selection and safe FTS5 literal-phrase encoding in `src/compiler/search/query.ts`
- [ ] T110 [US3] Implement current-version/visibility-filtered FTS5 search and bounded short-field `instr()` fallback with cursor/result limits in `src/db/repositories/book-search.ts`
- [ ] T111 [US3] Implement the book search endpoint with scope notice and safe result snippets/anchors in `src/pages/api/books/[bookKey]/search.ts`
- [ ] T112 [P] [US3] Implement reader search controls and result navigation to page/block without interpreting snippets as HTML in `src/components/reader/BookSearch.tsx`
- [ ] T113 [P] [US3] Implement safe title-derived UTF-8/ASCII Content-Disposition and strict single-range parsing in `src/http/downloads/filename.ts` and `src/http/downloads/range.ts`
- [ ] T114 [US3] Implement registered-original resolution and streaming 200/206/304/416 responses with auth before ETag/If-Range/Range in `src/pages/books/[bookKey]/originals/[fileId].ts`
- [ ] T115 [US3] Implement response integration tests for immediate public-to-private denial without rebuild and without leaking superseded/ready resources in `tests/integration/auth/visibility-transition.test.ts`
- [ ] T116 [US3] Run the complete User Story 3 contract, authorization, search, download, accessibility and browser suites and record passing evidence in `docs/audits/m1-us3-reader-evidence.md`

**Checkpoint**: User Stories 1–3 form the first complete public product slice.

---

## Phase 6: User Story 4 — Operate and recover background work (Priority: P3)

**Goal**: The administrator can inspect/cancel/retry durable work, and worker/Web/host
interruptions recover into documented states without exposing staging or publishing ready/
orphaned versions.

**Independent Test**: Kill the child, worker, Web and full Compose stack in every major
phase; restart; verify durable status, cleanup, at most one infrastructure auto-retry,
explicit retry for other failures, no automatic ready publication, book-scoped rollback and
continued availability of unrelated/current books.

**Requirements**: FR-032–FR-037, FR-040; NFR-001–NFR-002, NFR-004, NFR-006.

### Evidence tests for User Story 4

- [ ] T117 [P] [US4] Add failing OpenAPI contract tests for job status, cancel and explicit retry including immutable prior-attempt history in `tests/contract/jobs.contract.test.ts`
- [ ] T118 [P] [US4] Add failing two-real-worker claim, heartbeat, lease-expiry and global concurrency tests using one real SQLite file in `tests/integration/recovery/worker-leases.test.ts`
- [ ] T119 [P] [US4] Add failing child SIGTERM/10-second-grace/SIGKILL/close, 30-minute timeout simulation and process-group termination tests in `tests/integration/recovery/child-termination.test.ts`
- [ ] T120 [P] [US4] Add failing retry-policy tests for one infrastructure auto-retry and manual-only content/limit/timeout/repeat-interruption retries in `tests/integration/recovery/retry-policy.test.ts`
- [ ] T121 [P] [US4] Add failing startup inventory tests for incomplete staging, orphan complete directory, missing DB/files, corrupt current, ready non-publication, predecessor rollback and book-scoped 503 in `tests/integration/recovery/reconciliation.test.ts`
- [ ] T122 [P] [US4] Add failing retention tests for current/previous preservation, 24-hour quarantine/grace, FTS cleanup and cleanup-failure non-interference in `tests/integration/recovery/retention.test.ts`
- [ ] T123 [P] [US4] Add failing worker-owned passive checkpoint, WAL-size alert, Web 250 ms busy bound and startup WAL-recovery retry tests in `tests/integration/storage/wal-operations.test.ts`
- [ ] T124 [US4] Add a failing production-stack browser/process journey for task status, cancellation, restart, retry and unchanged current publication in `tests/e2e/worker-recovery.spec.ts`

### Implementation for User Story 4

- [ ] T125 [P] [US4] Implement authorized job status serialization with safe phase/progress/error categories in `src/services/job-status.ts` and `src/pages/api/manage/jobs/[jobId]/index.ts`
- [ ] T126 [US4] Implement cancel and explicit-retry endpoints with origin/idempotency checks and new immutable attempt rows in `src/pages/api/manage/jobs/[jobId]/cancel.ts` and `src/pages/api/manage/jobs/[jobId]/retry.ts`
- [ ] T127 [P] [US4] Implement the task list/detail, phase progress, cancellation, failure-category and retry interface in `src/components/import/TaskMonitor.tsx` and `src/pages/manage/tasks.astro`
- [ ] T128 [US4] Implement cooperative cancellation followed by a fixed 10-second SIGTERM grace, whole-process-group SIGKILL escalation and close-confirmed terminal state in `src/worker/child-runner.ts`
- [ ] T129 [US4] Implement expired-lease interruption classification, staging cleanup and one-time infrastructure auto-retry creation in `src/jobs/recovery.ts`
- [ ] T130 [US4] Implement explicit retry eligibility for content, validation, security-limit, timeout and repeat interruption failures in `src/jobs/retry-policy.ts`
- [ ] T131 [US4] Implement startup inventory and reconciliation for staging, quarantine, version directories, DB rows and current pointers in `src/storage/reconcile.ts`
- [ ] T132 [US4] Implement quick current-version verification, background full-hash verification, corrupt-state marking and atomic verified-predecessor rollback in `src/services/version-verifier.ts` and `src/jobs/handlers/verify-version.ts`
- [ ] T133 [US4] Implement 24-hour orphan quarantine and retention-safe version/FTS reclamation that always preserves current and previous verified versions in `src/jobs/handlers/reconcile.ts` and `src/jobs/handlers/reclaim.ts`
- [ ] T134 [US4] Implement worker-owned scheduled PASSIVE checkpoints, WAL/lease health reporting and maintenance-only checkpoint controls in `src/worker/checkpoint.ts` and `src/pages/api/manage/health.ts`
- [ ] T135 [P] [US4] Implement structured phase timings, queue age, disk usage, publication/recovery transitions, read/search percentiles and safe failure counters in `src/observability/metrics.ts`
- [ ] T136 [US4] Wire reconciliation before worker claims and ensure Web startup contains corruption to one book in `src/worker/index.ts` and `src/middleware.ts`
- [ ] T137 [US4] Run the complete User Story 4 contract, lease, termination, retry, reconciliation, retention, WAL and production-stack suites and record passing evidence in `docs/audits/m1-us4-recovery-evidence.md`

**Checkpoint**: All four stories and every documented restart/failure class pass.

---

## Phase 7: Polish and Cross-Cutting Release Gates

**Purpose**: Prove the integrated M1 against migration, security, performance,
reproducibility, deployment and documentation gates.

- [ ] T138 [P] Add generated OpenAPI/schema validation, operation-to-route coverage and response-header contract checks to `tests/contract/openapi-validation.test.ts`
- [ ] T139 [P] Add a full cross-route authorization/cache matrix covering login, manage, errors, redirects, public/private HTML, assets, previews, APIs and downloads in `tests/integration/auth/full-route-matrix.test.ts`
- [ ] T140 [P] Add dependency-version, linked-SQLite, FTS5, image-decoder and compiler-identity capture to `scripts/benchmarks/environment.ts`
- [ ] T141 Implement production build/import benchmarks that record wall time, peak child memory, bytes/entries, output/index size and FTS build time for every registered real MinerU fixture plus the synthetic stress fixture in `scripts/benchmarks/build.ts`
- [ ] T142 Implement production HTTP benchmarks for idle/concurrent-build read p50/p95/p99 and normal/short search p50/p95/p99 in `scripts/benchmarks/read.ts` and `scripts/benchmarks/search.ts`
- [ ] T143 Require all administrator-supplied real fixture hashes, run each real and synthetic stress benchmark on the reference host, enforce read p95 <=300 ms and supported search p95 <1 s, and save raw/configured results in `docs/audits/m1-performance-report.md`
- [ ] T144 Exercise every migration and complete recovery against a disposable copy of representative persistent data and record backup/restore evidence in `docs/audits/m1-migration-recovery-report.md`
- [ ] T145 [P] Harden container permissions, read-only application filesystem, writable data volume, Caddy security headers, process-group shutdown and non-root health checks in `docker/Dockerfile`, `docker/compose.yaml`, and `docker/Caddyfile`
- [ ] T146 [P] Document install, migration, bootstrap/recovery, Web/worker lifecycle, storage layout, monitoring, quarantine and incident procedures in `README.md`, `docs/operations/deployment.md`, and `docs/operations/recovery.md`
- [ ] T147 Perform a final documentation and external-code provenance consistency check across `docs/decisions/decision-log.md`, `docs/product/product-spec.md`, `docs/architecture/m1-architecture.md`, `docs/third-party/code-provenance.md`, and `specs/001-mineru-public-publishing/`; any decision change discovered earlier must already have paused affected work and updated these authorities before its implementation
- [ ] T148 Run every command and scenario in `specs/001-mineru-public-publishing/quickstart.md` against the production build and record deviations/final evidence in `docs/audits/m1-quickstart-report.md`
- [ ] T149 Run frozen-install commitlint, lint, formatting, typecheck, unit, integration, contract, browser and production-build gates and record the exact passing commands in `docs/audits/m1-release-verification.md`
- [ ] T150 Perform the final spec/plan/tasks/implementation consistency analysis, resolve every unmitigated CRITICAL finding, and save the final audit in `docs/audits/m1-final-consistency.md`

---

## Dependencies and Execution Order

### Phase dependencies

- **Phase 1 — Setup**: starts immediately.
- **Phase 2 — Foundational**: depends on Phase 1 and blocks every user story.
- **Phase 3 — US1**: depends on Phase 2; produces the durable private draft.
- **Phase 4 — US2**: depends on US1's prepared draft model and completes immutable publish.
- **Phase 5 — US3**: depends on US2's current published version and completes the public
  reader slice.
- **Phase 6 — US4**: depends on the foundational queue. Its lease/termination work can begin
  after Phase 2 in parallel with US1–US3, but final reconciliation evidence depends on the
  publication/version model from US2.
- **Phase 7 — Release gates**: depends on all four selected stories.

### User-story dependency graph

```text
Setup
  └─ Foundation
       ├─ US1 Import/private preview
       │    └─ US2 Atomic publication
       │         └─ US3 Public read/search/download
       └─ US4 Worker operations/recovery
            └──── integrates with US2 publication recovery
```

### Within each user story

1. Write the story's evidence tests and confirm the expected failures.
2. Implement repositories and pure policies.
3. Implement services/compiler/worker behavior.
4. Implement endpoints and UI.
5. Run the story independently and capture evidence at its checkpoint.

## Parallel Opportunities

### Setup and foundation

- T002–T008 touch separate configuration/deployment files and may proceed together after
  T001.
- T010–T017 are independent failing-evidence suites after T004.
- T019–T020, T031, T037–T039 touch separate modules/fixtures and may proceed while the core
  DB/auth/storage chain T021–T036 advances.

### User Story 1

```text
Parallel evidence: T040, T041, T042, T043, T044, T045, T046, T047, T048
Parallel pure modules after evidence: T052, T055, T057, T059, T061, T062
UI can start from the OpenAPI fixtures: T068
```

### User Story 2

```text
Parallel evidence: T070, T071, T072, T073, T074, T075, T076, T077
Parallel render/policy modules: T079, T083, T084, T088, T090
Structure UI can start after validation types settle: T082
```

### User Story 3

```text
Parallel evidence: T096, T097, T098, T099, T100, T101
Parallel reader/search/download primitives: T103, T107, T109, T113
```

### User Story 4

```text
Parallel evidence: T117, T118, T119, T120, T121, T122, T123
Parallel status UI and metrics: T125, T127, T135
```

## Implementation Strategy

### Technical MVP

1. Complete Setup and Foundational phases.
2. Complete US1.
3. Stop and validate the secure private draft import independently.

This is the smallest technically useful checkpoint, but it is not yet the public product.

### First public product slice

1. Complete Setup + Foundational.
2. Complete US1 secure import/private preview.
3. Complete US2 atomic publication.
4. Complete US3 public read/search/download.
5. Run the applicable release gates before exposing the service.

### Operational completion

Complete US4 and all Phase 7 gates before declaring M1 complete. No phase may waive failed
authorization, archive, publication, recovery, migration or performance evidence.

## Notes

- `[P]` means different files and no dependency on another unfinished task in the same
  parallel group.
- `[US1]`–`[US4]` map directly to the four approved feature stories.
- Tests precede implementation and must fail for the intended missing behavior first.
- Commit after each task or cohesive task group once the repository is initialized.
- Never mark a task complete solely because a mocked test passes for filesystem, SQLite,
  process termination, authorization or publication behavior.
