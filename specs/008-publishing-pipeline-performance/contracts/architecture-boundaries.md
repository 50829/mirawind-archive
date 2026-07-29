# Architecture Boundary Contract

## Dependency Direction

```text
pages / web / worker / cli
              ↓
       module application
              ↓
          module core

module adapters ──→ application ports + core
composition     ──→ application + adapters
```

## Required Rules

- Product source imports use `@/`; relative imports are permitted only within the same leaf folder
  for generated/framework files explicitly allowlisted by the architecture configuration.
- Core imports only its own module core and approved dependency libraries.
- Application imports its module core, its own ports and another module's `application/public.ts`.
- Application never imports adapters, platform implementations, pages, web UI or entrypoints.
- Adapters implement application ports and may import their own module core plus platform primitives.
- Cross-module imports target only `@/modules/<module>/application/public`.
- Composition roots may import application and adapters; no other location assembles them.
- The dependency graph contains no strongly connected component larger than one node and no
  self-cycle.
- The graph includes static, dynamic and type-only imports and reports the shortest offending path.
- Outside composition roots, direct internal file fan-out is at most twelve and an application use
  case injects at most eight ports. The completed graph has no coupling exception allowlist.

## Negative Fixtures

Tests must prove rejection of core-to-adapter, application-to-adapter, cross-module deep import,
relative product import, alias escape, dynamic forbidden import, type-only forbidden import, direct
page-to-repository access, two-node cycle and longer cycle.
