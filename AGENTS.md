# Mirawind Library agent guidance

## Authority

Read these sources before planning or implementation, in this order:

1. `.specify/memory/constitution.md`
2. `docs/decisions/decision-log.md`
3. `docs/product/product-spec.md`
4. The active `specs/<feature>/spec.md`, plan, contracts, and tasks
5. `docs/research/` and `docs/schemas/`

If two artifacts disagree, stop implementation of the conflicting area and update the lower
authority artifact. Do not silently choose one.

## Workflow

- Use Spec Kit in order: specify → plan → checklist → tasks → analyze → implement →
  converge.
- Do not reopen product grilling for choices already covered by D-001 through D-086.
- New product decisions go into `docs/decisions/decision-log.md` before code.
- Schema changes require a version decision, migration, fixtures, and compatibility tests.
- Keep specs, plans, tasks, tests, and runtime docs synchronized with behavior.

## Non-negotiable architecture

- One Linux host, one Astro Web process, one same-codebase worker, SQLite WAL, and local
  persistent storage.
- Markdown plus versioned `book.yaml` are authoritative. AST, HTML, manifest, resources,
  and search indexes are derived and rebuildable.
- Published versions are immutable. SQLite `current_version_id` is the only current pointer.
- Parsing, rendering, image work, and indexing never run in reader requests.
- All book resources remain outside static public directories and pass through server-side
  authorization.
- Treat every ZIP entry and imported document as hostile input.
- Do not introduce Redis, another database, object storage, microservices, or multiple app
  instances without an approved architecture and constitution change.

## Implementation rules

- Reuse maintained libraries for authentication, archive parsing, Markdown, sanitization,
  KaTeX, highlighting, image metadata, and cryptography.
- Preserve user changes and unrelated work. Avoid destructive migrations and in-place
  mutation of published versions.
- Use opaque generated IDs. Do not derive identity from title, path, or mutable text.
- Never log credentials, cookies, complete private content, unsafe raw archive paths, or
  recovery secrets.
- Every response class must declare its authentication, authorization, cache, and indexing
  behavior.
- Enforce resource limits while streaming; metadata-only checks are not sufficient.

## Required evidence

Tests are mandatory for:

- archive traversal, link/special-file rejection, limits, malformed ZIPs, and cleanup;
- schema validation, unknown fields, migrations, and semantic cross-field checks;
- authentication, authorization, private-resource 404 behavior, cache headers, and downloads;
- worker leases, interruption, timeout, cancellation, and retry limits;
- FTS query escaping, current-version filtering, and private/old-version exclusion;
- publication crash boundaries, rollback, orphan recovery, and immutable versions;
- representative and stress MinerU books, including the 300 ms uncached reading target.

Implementation is not complete until these tests pass and Spec Kit analysis has no
unmitigated CRITICAL findings.
