# Research

- **Reader**: The defect is CSS-only. Shared descendant styles fix preview and publication
  without changing generated HTML, KaTeX, or renderer identity.
- **Details**: Catalog already provides `coverUrl`, ordered TOC, total count, reading route, and
  downloads. The component only needs a 16-item view projection and responsive layout.
- **Management**: Astro already owns page shells and authentication. One Astro component avoids
  extra hydration and leaves existing React islands intact.
- **Anonymous enhancement**: An HttpOnly session cannot be checked safely in browser code.
  A minimal private no-store capability response preserves identical public HTML while avoiding
  the routine protected-API `401`. Making the protected API anonymous or varying public HTML
  would weaken the current boundary.
