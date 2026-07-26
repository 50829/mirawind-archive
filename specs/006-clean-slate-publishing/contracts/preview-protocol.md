# Preview Iframe Protocol

The iframe is always `sandbox="allow-scripts"` without `allow-same-origin`.

The child may send only:

```text
ready:    { type, revision, page_id, fragment }
location: { type, revision, page_id, fragment }
navigate: { type, revision, page_id, fragment }
```

Concrete type names are `mirawind-preview-ready`,
`mirawind-preview-location` and `mirawind-preview-navigate`.

The parent accepts a message only when:

- `event.source` is the current iframe window;
- `revision` equals the displayed preview revision;
- `page_id` is a page in that preview;
- `fragment` is null or a bounded block identifier;
- `type` is one of the three values above.

Navigation is performed by the authenticated parent changing the revision-pinned iframe
URL. No message contains body text, file paths, resource authorization or session data.
