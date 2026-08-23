# Architecture Boundary Contract

## Required Dependency Direction

```text
Reader -> Publishing -> Catalog
Identity (independent)

entrypoints/pages/web -> composition -> module application + adapters
module adapters -> own application ports + own core
module application -> own core + other module application/public
module core -> own core + domain primitives
```

## Rules

- Both the resolved file graph and the aggregated business-module graph must be acyclic.
- Cross-module imports target only the providing module's `application/public.ts`.
- Catalog must not import Publishing code, query Publishing lifecycle tables or accept Publishing
  version records and paths.
- Publishing may invoke Catalog's bounded presentation and cleanup operations.
- Reader may consume only explicit immutable renderer assets and reader-manifest projections.
- Composition may instantiate adapters and open a shared transaction but must not contain business
  SQL, table ownership, version transition or retry policy.
- Entry points and pages import focused composition roots; no compatibility barrel is retained.
- Each application port contains only operations used by its consumer.

## Required Negative Evidence

- legal public-surface imports forming a two-module cycle;
- legal public-surface imports forming a longer module cycle;
- existing core/adapter, application/adapter, deep cross-module, relative import and file-cycle
  fixtures;
- composition-owned SQL referencing module business tables.
