# Research

- **Active document**: Production currently computes an active document but structures the full document;
  the fix is a typed `PreparedDocument` boundary, not another filter.
- **Heading presentation**: Plain title overrides cause duplicate numbers and discard inline AST. Compile one
  sanitized rich label for every consumer.
- **Source editing**: Immutable Markdown revisions with reused asset bindings avoid copying whole resource
  trees for one block edit.
- **Reader**: Parent TOC links must not live inside the collapsed element; page identity, current TOC item and
  page outline are separate values.
- **Validation**: Reference-v2 comparison alone misses the production wiring bug; retain it and add one full
  preparation-to-Reader fixture.
- **Material for MkDocs reference**: At commit
  [`1912859`](https://github.com/squidfunk/mkdocs-material/tree/191285962d5a2c1aa1e5764e9979219268a164c3),
  TOC links remain separate from their child navigation, code blocks own a focused copy control, prose
  explicitly restores list/blockquote/code rhythm, and fragment placement uses `scroll-margin`. Mirawind
  adopts these behaviors with its existing runtime; it does not import Material's RxJS/theme framework.
