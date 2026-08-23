# Data Model: Naming, Import, and Path Closure

This feature adds no authoritative database entity or persisted schema. These models describe
build-time and filesystem-boundary values.

## Source Package

- `name`: business module name or top-level ownership tree
- `root`: canonical repository-relative source directory
- `sourceFile`: importing file
- `targetFile`: resolved first-party file
- `relationship`: `local | cross-package | cross-module`
- `canonicalSpecifier`: relative for local; `@/` for cross-package

The dependency graph always uses resolved files. Specifier spelling cannot change the resulting
layer, module, coupling or cycle decision.

## Application API

- `domain`: `catalog | identity | publishing | reader`
- `path`: `modules/<domain>/application/<domain>-api.ts`
- `exports`: current narrow use cases, queries, policies, ports and immutable-format projections
- `consumers`: entrypoints, Web/HTTP composition, or another business module

There is exactly one public application API per business module in this feature. Internal module
files do not import their own API barrel.

## Versioned Representation

- `semanticRuntimeName`: current concept without a history suffix
- `schemaVersion` or `identity`: required explicit stored/external version
- `transitionPolicy`: current strict validation or approved clean switch
- `compatibility`: unchanged for book v4, manifest v3, version marker v3, worker health v2 and
  reference v2

Runtime names do not create a second version; validators continue rejecting old or unknown data.

## Canonical Relative Path

- `components`: one or more non-empty POSIX components
- `value`: components joined by `/`
- `root`: canonical absolute directory owned by the caller
- `target`: lexical resolution of `value` beneath `root`

Validation rejects absolute prefixes, backslashes, NUL/control characters, empty/repeated components,
`.` and `..`. The root itself is not a valid target.

## Archive Path Identity

- `normalizedPath`: NFC POSIX path used for extraction
- `collisionKey`: normalized case-folded key used only for ambiguity detection
- `components`, `directoryDepth`, `pathBytes`, `isDirectory`
- `entryType`: file or directory
- `compressionMethod`, `compressedSize`, `uncompressedSize`, `signature`, encryption flags

State transitions:

```text
raw ZIP name -> normalized and registered -> inspected identity
inspected identity + equal second-pass entry -> extracted
inspected identity + mismatch -> rejected -> incomplete destination removed
```

## Storage Layout

- `root`: canonical non-symlink absolute directory, never `/`
- `databaseDirectory`, `bookDirectory`, `temporaryDirectory`, `uploadDirectory`: canonical managed
  directories beneath `root`, non-symlink and private
- `device`: common filesystem device required for atomic rename boundaries

## Atomic Replacement

- `target`: current durable file
- `temporary`: exclusive no-follow file in the target directory
- `state`: `created | written | synced | renamed | parent-synced | cleaned`

Before rename, any failure closes and removes the temporary file while leaving the target unchanged.
After rename, the target is authoritative; parent sync failure remains an I/O error and is not rolled
back to a guessed prior representation.
