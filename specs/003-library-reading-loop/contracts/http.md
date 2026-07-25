# HTTP contract: Library and Reading Loop

## Response matrix

| Route / response                        | Authorization and representation                                                                         | Cache                                                          | Indexing                                                |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------- |
| `GET /library`                          | Complete SSR of current public projected books; identical for every session                              | `public, max-age=0, must-revalidate` + strong ETag             | index/follow with canonical `/library`                  |
| `GET /books/:bookKey` for a public book | Complete SSR library backdrop and current-version details dialog; identical for every session            | public revalidation + route-specific strong ETag               | index/follow with canonical current key                 |
| `GET /books/:bookKey` for draft/private | Sole administrator only; anonymous is indistinguishable `404`                                            | `private, no-store`; anonymous `404` is `no-store`             | noindex                                                 |
| `GET /api/books/:bookKey/details`       | Current public projection, bounded TOC and current-source originals; public bytes do not vary by session | public revalidation + strong ETag                              | `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet` |
| `GET /api/manage/library`               | Sole administrator; paginated draft/private/current lifecycle entries                                    | `private, no-store`                                            | noindex                                                 |
| Existing reader/search/assets/downloads | Existing M1 authorization and current-version contracts, with presentation title/canonical key           | Existing policy; search JSON adopts public JSON noindex policy | Existing public/private boundary                        |
| Numeric canonical redirect              | Resolve and authorize current object before redirect                                                     | `no-store`                                                     | noindex                                                 |
| Hidden/missing                          | Missing, invalid key, anonymous draft/private, ready, reclaimed, orphan or unauthorized                  | `no-store`                                                     | noindex                                                 |
| Current public book unavailable         | Known current public projection/manifest/required file unavailable with no recovery                      | `no-store`, optional `Retry-After: 30`                         | noindex                                                 |

Conditional responses are evaluated only after authorization and current-version resolution.
A visibility change with an old `If-None-Match` must return a non-cacheable `404`, never
`304`.

## `GET /api/books/:bookKey/details`

Success response:

```json
{
  "book": {
    "book_key": "example-book",
    "book_id": 1,
    "version_id": "ver_opaque",
    "title": "Example Book",
    "subtitle": null,
    "authors": ["Author"],
    "description": null,
    "language": "zh-CN",
    "cover_url": null,
    "start_url": "/read/example-book/1"
  },
  "toc": [
    {
      "level": 1,
      "number": "1",
      "title": "Opening",
      "href": "/read/example-book/1#blk_opaque"
    }
  ],
  "toc_entry_count": 1,
  "toc_truncated": false,
  "originals": [
    {
      "label": "Example Book · MinerU ZIP",
      "media_type": "application/zip",
      "size_bytes": 1024,
      "href": "/books/example-book/originals/file_opaque"
    }
  ]
}
```

Limits:

- at most 100 authors and 100 contributors;
- description at most 10,000 characters;
- at most 200 TOC preview rows and 256 KiB canonical preview JSON;
- at most 100 registered originals;
- no server paths, source paths, draft fields or internal diagnostics.

Numeric keys for an aliased book return a `302` no-store redirect to the canonical API
address. Unsupported keys and hidden books return the common JSON `404`. A known current
public book with a missing projection returns the common safe JSON `503`.

## `GET /api/manage/library`

Query:

- `cursor`: optional opaque positive book-ID cursor;
- `limit`: optional integer, default 100, maximum 100.

Success response:

```json
{
  "entries": [
    {
      "book_id": 2,
      "title": "Draft title",
      "visibility": "draft",
      "current_version_available": false,
      "preview_ready": true,
      "status_label": "草稿",
      "primary_href": "/manage/books/2/preview"
    }
  ],
  "next_cursor": null
}
```

The endpoint returns only bounded display state. It does not return book body, notes,
credentials, filesystem paths, raw errors or unredacted job progress. Unauthenticated
requests use the existing JSON `401`; an authenticated non-administrator uses `403`.

## ETag identities

- Library: renderer identity plus the ordered tuple of current public book ID, current
  version ID, current alias and projection digest.
- Details HTML: actual request path, library digest, current book/version, presentation
  digest and details renderer identity.
- Details JSON: actual canonical request path, current book/version, presentation digest,
  current originals identities and JSON renderer identity.
- Reader: existing request route, version, page and renderer identity.

Draft/private changes must not alter a public ETag. A successful pointer switch must alter
all affected public library, details, reader and search identities together.
