# Research: Library and Reading Loop

## R-001 — Project current-version presentation data into SQLite

**Decision**: Add one `book_version_presentations` row per immutable version. Generate it
from the frozen, validated `book.yaml` and document manifest in the build/worker path. Public
queries reach it only through `books.current_version_id`.

**Rationale**: `books.title_cache` currently follows draft configuration and can therefore
diverge from the old public version. Request-time file parsing would fan out over the
library and violate the 300 ms and request-path constraints. A bounded projection remains
derived, transactional and rebuildable.

**Alternatives considered**:

- Read `book.yaml` and manifest on every request: rejected because file fan-out and parsing
  are unbounded and draft/current consistency becomes harder to prove.
- Add metadata to manifest v2: rejected because v1 already contains the navigation/resource
  inputs and the frozen v1 `book.yaml` already owns metadata.
- Generate a global `library.json`: rejected because it would add a filesystem current
  pointer and cross-book cutover boundary.
- Add many presentation columns to `book_versions`: rejected because the projection has its
  own evolution and can be reclaimed independently from the immutable version lineage.

## R-002 — Promote alias only with the current version

**Decision**: Store the version-frozen alias in the presentation. Draft configuration may
carry a future alias but cannot update the public `books.alias`. The final publication
transaction verifies uniqueness and promotes presentation alias and `current_version_id`
together.

**Rationale**: The existing draft update path can change `books.alias` before publication,
which can invalidate pre-generated canonical links while the old version remains current.
The existing unique column remains the single current-alias lookup and old aliases become
immediately reusable after cutover.

**Alternatives considered**:

- A separate global alias-claims table: rejected because it creates another current mapping
  that can diverge from the book pointer.
- Let draft alias changes apply immediately: rejected because publication would no longer
  be atomic from a reader's perspective.

## R-003 — Keep public HTML session-independent

**Decision**: Fully server-render public `/library` and public `/books/:bookKey` from current
published projections and return identical bytes for all sessions. Load draft/private cards
through `/api/manage/library`, which requires the sole administrator and prohibits storage.

**Rationale**: Public HTML can remain safely revalidated by shared caches and search engines
without `Vary: Cookie`. Logout and private-state changes cannot expose an administrator
variant.

**Alternatives considered**:

- Render admin cards when a session cookie is present: rejected because public cache keys
  and logout behavior become unsafe.
- Make the entire library private/no-store for everyone: rejected because it gives up the
  approved public SEO and conditional-request behavior.

## R-004 — Use SSR-first route dialogs with progressive enhancement

**Decision**: Render `/library` and `/books/:bookKey` through one `LibraryScene`. Details
links remain ordinary URLs. A direct details route contains the complete library backdrop
and an open native dialog; a small enhancement script uses `showModal()`, browser history
and a short-lived `sessionStorage` record to restore scroll and opener focus.

**Rationale**: Direct links and no-JavaScript navigation remain complete. Native dialog
supplies inert background, Escape behavior and focus containment without a client router or
custom focus-trap implementation.

**Alternatives considered**:

- React Router or Astro global client routing: rejected because it expands hydration and
  can retain stale public/private DOM across visibility changes.
- Custom ARIA modal: rejected because it duplicates native focus, inert and Escape behavior.
- CSS-only target modal: rejected because history and focus restoration are incomplete.

## R-005 — Enhance mobile reader controls without changing the read path

**Decision**: Bump the book renderer identity and emit explicit mobile controls for bounded
TOC, page outline, search and download dialogs. Without enhancement these sections remain in
normal semantic flow. Keyboard page navigation ignores open dialogs and every interactive,
editable, focusable, code or role-bearing target.

**Rationale**: Reader HTML is still generated in the background and served verbatim.
Existing immutable v1 reader pages remain valid; books acquire the v2 shell on their next
explicit publish. No runtime rewriting or implicit publication is introduced.

**Alternatives considered**:

- Wrap old page fragments in a runtime shell: rejected because it moves rendering back into
  reader requests and changes immutable response bytes.
- Swipe pagination: rejected by the product specification.

## R-006 — Define separate public JSON and private management policies

**Decision**: Public details/search JSON uses immediate revalidation plus a strong ETag and
an explicit noindex robots header. Administrator JSON, private HTML and private reads use
`private, no-store`. Authorization and current-version resolution precede all conditional
or Range handling.

**Rationale**: JSON enhancement can save bandwidth without becoming an indexable content
surface. An old ETag can never turn a newly private book into a `304`.

**Alternatives considered**:

- Reuse public HTML policy unchanged for JSON: rejected because the indexing contract would
  be implicit.
- Use long-lived immutable details JSON: rejected because visibility and current alias can
  change.

## R-007 — Reconcile old versions off the request path

**Decision**: Migration 6 creates an empty projection table. Worker startup reconciliation
builds missing projections for unreclaimed `ready`, `published` and `superseded` versions,
validates existing digests, and refuses to restore a version without a valid projection.
Reclamation removes its projection with search data while retaining the version tombstone.

**Rationale**: SQL migration stays forward-only and filesystem-independent. Existing
published reading pages stay available while bounded backfill runs, and no HTTP request
falls back to draft caches.

**Alternatives considered**:

- Parse every version during SQL migration: rejected because the migration layer does not
  own filesystem validation and a single damaged book could block schema upgrade.
- Lazy HTTP backfill: rejected because it violates request-path and failure-isolation rules.

## R-008 — Test accessibility as an explicit release gate

**Decision**: Declare the already transitive `axe-core` package as a direct development
dependency and run serious/critical scans in desktop and mobile Playwright journeys. Keep
semantic/keyboard assertions because automated scanning does not replace behavior tests.

**Rationale**: The specification makes a severity-based claim that cannot be honestly
verified with role locators alone. The dependency is test-only and does not affect runtime
architecture.

**Alternatives considered**:

- Only use role and focus assertions: rejected because they cannot establish the declared
  scan-severity outcome.
