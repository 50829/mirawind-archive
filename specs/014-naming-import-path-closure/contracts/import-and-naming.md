# Import and Naming Contract

## Package Map

- `src/modules/<domain>/` is one business package.
- Each other direct child ownership tree of `src/` is one package: `composition`, `config`, `domain`,
  `entrypoints`, `http`, `observability`, `pages`, `platform`, `styles`, and `web`.
- Direct files below `src/`, including `env.d.ts` and `middleware.ts`, belong to `src-root`.
- `@/schemas/*` is a reserved authoritative-data alias to `docs/schemas/`, not a product package.
- External packages and Node built-ins retain their package specifiers.
- Tests and scripts use relative imports within their own support tree. Their product-source imports
  retain the form supported by that runner and are outside bulk product canonicalization.

## Canonical Imports

1. Resolve the import to its first-party target.
2. When source and target share a package, use the shortest relative specifier without a source
   extension.
3. When they differ, use a source-root `@/` specifier.
4. Imports matching `@/schemas/*` retain that reserved alias and resolve against authoritative data.
5. A cross-business-module target must be `modules/<domain>/application/<domain>-api.ts`.
6. Entrypoints, pages and web code may enter a business module only through that same application API.
7. Type-only, export-from and dynamic imports follow identical rules.

All resolved edges still pass layer, module, direct-dependency, injected-port, SQL ownership and cycle
analysis. A canonical spelling never grants permission to an otherwise forbidden edge.

## Semantic Names

- Current first-party runtime files, fields, types and functions do not end in `V<number>` or carry
  `legacy` as an implementation distinction.
- Domain application APIs use `<domain>-api.ts`.
- A file containing one worker child handler contract uses `job-handler.ts`.
- Filesystem primitives use `storage-layout.ts`, `contained-path.ts` and `atomic-file.ts`.
- Stored `schema_version`, identity/profile literals, external vendor filenames and offline reference
  values retain explicit versions.
- Renames are direct. No previous-name export or forwarding file remains.
