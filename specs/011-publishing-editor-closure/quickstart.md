# Validation

1. Run focused schema, preparation, compiler, Reader and management tests while implementing each phase.
2. Build one CSAPP candidate and verify removed printed TOC, Part/Chapter hierarchy and appendix continuity.
3. Use Playwright at 320/360/768/1024/1440 for Reader and workbench interactions.
4. Run the current fifteen-book reference comparison once, representative performance and concurrent read.
5. Run format, lint/architecture, typecheck, test, build and Spec Kit converge.
6. Reset the verified local Compose volume, bootstrap the administrator and validate on `localhost:4321`.

## Closure Evidence

- Fifteen-book comparison: `15/15 exact` in `.cache/011-publishing-editor-closure/t020-reference-compare-closure-final.json`.
- Current-B: 15 books passed in 244.827 s; median 14.520 s; slowest 44.364 s.
- 500-page stress: 501 pages and 12,002 blocks passed in 10.860 s; peak RSS 867,012,608 bytes.
- During-build p95: page 137.469 ms, resource 130.004 ms, search 59.469 ms; all 600 requests overlapped the build.
- Final gates: format, lint, typecheck, 658 Vitest tests, 21 Playwright tests and production build passed.
