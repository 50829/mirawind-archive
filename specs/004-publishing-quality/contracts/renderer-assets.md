# Contract: Renderer assets

## Build closure

Before development and production builds, a deterministic script generates:

```text
public/_astro/renderers/semantic-html-v3-katex-0.18.1/
├── katex.min.css
├── fonts/                 # exactly the 20 referenced WOFF2 files
├── LICENSE
└── integrity.json
```

The generated directory is ignored by Git and recreated only from the pinned production
dependency. The script fails unless:

- the resolved engine is exactly KaTeX 0.18.1;
- markup generation and rehype rendering resolve the same engine;
- CSS contains only local WOFF2 font URLs;
- all and only referenced font files exist;
- the integrity manifest covers CSS, fonts and license;
- no external, WOFF or TTF URL remains.

`astro build` copies this closure to the corresponding `dist/client/_astro/renderers/`
path. The Docker runtime already copies complete `dist`, so no runtime mutation is needed.

## HTTP response class

`GET|HEAD /_astro/renderers/semantic-html-v3-katex-0.18.1/:assetPath`

| Property | Contract |
| --- | --- |
| Authentication | None; application renderer bytes contain no book or user data |
| Authorization | Exact generated static closure only |
| Content-Type | CSS, WOFF2 or plain-text/JSON type matching the file |
| Cache-Control | `public, max-age=31536000, immutable` |
| Identity | Content hash and renderer-versioned path |
| Indexing | Application assets only; absent from navigation and book search |
| Cookies/session variation | Forbidden |

Traversal, encoded separators and files outside the generated closure never enter the build
output.

## HTML integration

Every `semantic-html-v3-katex-0.18.1` preview and reading page includes:

```html
<link
  rel="stylesheet"
  href="/_astro/renderers/semantic-html-v3-katex-0.18.1/katex.min.css"
/>
```

The stylesheet's font URLs resolve within the same closure. Formula HTML retains
`.katex-mathml` and `.katex-html`; browser validation must establish that MathML is
available to assistive technology but not laid out as a second visible formula.
