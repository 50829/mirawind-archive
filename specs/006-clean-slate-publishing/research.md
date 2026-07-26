# Research: Clean-slate Publishing and Reading

## Opaque sandbox resources

**Decision**: keep preview page navigation session-authenticated and authorize each private
book resource with a one-hour HMAC capability bound to the active session, book, revision
and resource.

**Rationale**: removing `allow-same-origin` is required for isolation, but an opaque
sandbox cannot reliably use the management session cookie for subresources. Per-resource
authorization preserves isolation while logout, expiry, deletion and revision changes can
still invalidate access.

**Alternatives considered**: `allow-same-origin` was rejected because it collapses the
sandbox boundary; making previews public was rejected; embedding all resources as data URLs
was rejected because it breaks scale and resource reuse.

## Reader runtime

**Decision**: use one versioned external reader runtime for published and preview pages.

**Rationale**: it removes inline script from generated pages, supports a strict CSP and
keeps navigation/search behavior aligned. Preview-specific behavior activates only from
bounded data attributes.

**Alternatives considered**: duplicated preview scripts and generated inline scripts were
rejected because they drift and weaken CSP.

## Structure scale

**Decision**: virtualize only the workbench structure tree with TanStack Virtual and edit
only the selected node.

**Rationale**: the tree can reach thousands of headings while the actual reading page must
remain complete semantic DOM. Restricting virtualization to management avoids changing
reader accessibility or indexing.

**Alternatives considered**: rendering every editor and virtualizing reader content were
rejected.

## Upload transport

**Decision**: use XHR for upload byte progress and ordinary one-second HTTP polling for
background status.

**Rationale**: browser Fetch still does not provide portable upload progress. Existing
polling is sufficient for a single administrator and single worker.

**Alternatives considered**: SSE, WebSocket and a new queue service were rejected as
unnecessary infrastructure.

## Formula fallback

**Decision**: embed only the visually-hidden MathML critical rule and load full pinned
KaTeX CSS/fonts as versioned external assets.

**Rationale**: formulas remain visually singular and accessible even when the complete
stylesheet is blocked, without duplicating the renderer stylesheet in every page.

**Alternatives considered**: deleting MathML breaks accessibility; embedding the complete
KaTeX CSS bloats every page.
