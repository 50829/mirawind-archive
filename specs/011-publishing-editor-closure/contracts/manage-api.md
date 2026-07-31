# Management API

- `GET /api/manage/books/:id/draft`: metadata, boundaries, structure, candidate, preview and diagnostics + ETag.
- `PATCH /api/manage/books/:id/draft`: metadata/boundary/heading changes with `If-Match`; returns `202` candidate.
- `GET|PATCH /api/manage/books/:id/draft/blocks/:blockId`: bounded Markdown block with `If-Match`; PATCH
  creates a source/config revision and returns `202` candidate.
- `GET /api/manage/books/:id/draft/images`: private cover choices.
- `POST /api/manage/books/:id/draft/cover`: validated image upload with `If-Match`; returns `202` candidate.
- `POST /api/manage/books/:id/publish`: empty command with `If-Match`; server promotes current ready candidate.
- `PATCH /api/manage/books/:id/access`: `{ "access": "private" | "public" }`; public requires a version.

Diagnostics expose only executable targets: `{ kind: "select_structure" | "edit_block", blockId, pageId }`
or `{ kind: "reprocess_verbatim" }`. Evidence-only locations do not imply an action.

Unknown fields are rejected. Every response is authenticated, no-index and `private, no-store`; inaccessible
books and preview resources retain hidden 404 behavior.
