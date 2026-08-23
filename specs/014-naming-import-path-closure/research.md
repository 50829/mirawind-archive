# Research: Naming, Import, and Path Closure

## Decision 1: Canonical import form follows the target ownership package

**Decision**: Treat each business module and each top-level source ownership tree as a package, with
direct `src/` files in a `src-root` package. Use relative specifiers when source and target share that
package; use `@/` when they do not. Keep `@/schemas/*` as the explicit authoritative-data alias to
`docs/schemas/`. Resolve the target before applying architecture rules.

**Rationale**: The current 226 alias-using files hide locality and make adjacent imports unnecessarily
long. A relative-only repository would make cross-module boundaries visually weak and generate deep
`../../..` chains. Target-aware rules preserve both local brevity and cross-package clarity.

**Alternatives considered**: Keeping root aliases everywhere contradicts the request. Relative imports
everywhere obscure module boundaries. Adding aliases for every module increases TypeScript/Vite/test
configuration and still makes local imports look external.

Support code is intentionally separate: tests and scripts use relative imports within their own
trees, while imports of product code keep the form supported by their runner. The `src/` canonicalizer
does not rewrite support code.

## Decision 2: Public application files name their domain

**Decision**: Rename `application/public.ts` to `catalog-api.ts`, `identity-api.ts`,
`publishing-api.ts`, and `reader-api.ts`. Architecture rules derive the permitted facade name from
the target domain.

**Rationale**: `public.ts` is understandable only after reading its parent directories and produces
indistinguishable tabs/search results. Domain API names state both ownership and role while retaining
one narrow cross-module entry.

**Alternatives considered**: `index.ts` is less descriptive and encourages broad barrels. A generic
`api.ts` still depends on parent context. Multiple audience-specific facades would broaden the change
and complicate module-cycle analysis.

## Decision 3: Runtime APIs are semantic; data versions stay in data

**Decision**: Rename `PrintedContentsAnalysisV2`, its create/parse functions, and
`MineruReferenceV2` tooling to current semantic names. Keep `schema_version`,
`printed-contents-analysis-v2`, `reference v2`, vendor `content_list_v2.json`, and frozen identities
unchanged.

**Rationale**: There is only one supported runtime parser for each concept. Encoding its current
version in every call site adds historical noise and implies parallel APIs. The constitution still
requires explicit persisted versions and rejection of unsupported data, so those values must remain.

**Alternatives considered**: Removing numeric data versions violates strict schema governance.
Keeping suffixes on first-party APIs fails the requested naming cleanup. Compatibility aliases would
leave two public names and conflict with the clean-switch policy.

## Decision 4: Delete the plain-text PDF fallback

**Decision**: Parse native PDF evidence only as the TSV format explicitly requested from
`pdftotext -tsv`. A malformed or non-TSV result is invalid and proceeds through the existing bounded
OCR/diagnostic behavior; do not reinterpret it as legacy form-feed text.

**Rationale**: The command always requests TSV, so accepting a second unrelated shape masks tool
output errors and has no current producer. The branch is the sole runtime `legacy` implementation.

**Alternatives considered**: Renaming the fallback would conceal rather than remove it. Retaining it
for unspecified old Poppler behavior has no fixture or supported-format contract.

## Decision 5: Split filesystem responsibilities before hardening them

**Decision**: Move storage-root creation, canonical relative-path resolution, and atomic replacement
into named files. Keep their APIs small and update callers directly without a forwarding `layout.ts`.

**Rationale**: The current `layout.ts` owns three distinct failure models. Focused files make symlink,
containment, and temporary-file cleanup invariants independently testable and eliminate another vague
container name.

**Alternatives considered**: Leaving the file intact reduces moves but preserves unclear ownership.
A filesystem service class adds state and abstraction without solving a real boundary.

## Decision 6: Canonical internal paths reject normalization instead of repairing it

**Decision**: Accept only non-empty POSIX components already in canonical form. Reject backslashes,
absolute paths, empty/repeated components, `.`/`..`, NUL and control characters. Archive input has a
separate normalization policy because ZIP vendor paths require separator/NFC handling before collision
checks.

**Rationale**: Internal paths come from application-generated IDs and strict manifests; silently
normalizing unexpected stored input can bind a different file. Archive paths are hostile external
input and already have an explicit normalization-and-registry stage.

**Alternatives considered**: A single normalizer for both domains conflates untrusted archive names
with canonical internal records. Realpath-only containment requires the target to exist and cannot
validate output paths before creation.

## Decision 7: Archive registry uses a collision key and prefix map

**Decision**: Compute a Unicode-normalized, locale-independent case-fold key for each archive path,
reject key collisions, and use the existing prefix type map to detect file/directory conflicts without
scanning all registered keys.

**Rationale**: NFC alone permits names that collide on common case-insensitive filesystems. The
current descendant check can scan all 20,000 paths for each late file entry. Prefix metadata already
contains the information needed for bounded checks.

**Alternatives considered**: Linux-only byte identity ignores portable archive ambiguity. Sorting all
paths after inspection delays rejection and duplicates registry state. Full Unicode case-fold tables
would add a dependency; lowercasing normalized keys is sufficient for the current approved collision
policy and receives focused non-ASCII fixtures.

## Decision 8: Recheck ZIP entry identity during extraction

**Decision**: Normalize and compare each second-pass entry's path, type, compression method, sizes,
encryption flags and signature with its inspected record before creating its target.

**Rationale**: Comparing only entry count and directory flag allows a replaced archive to bind
different names or data between inspection and extraction. The worker holds a path, not an immutable
open descriptor shared by both readers.

**Alternatives considered**: Reading a 2 GiB archive into memory is prohibited. Trusting private file
permissions does not establish a code invariant. Reworking zip.js around one reader would be broader
and still require identity checks after central-directory parsing.

## Decision 9: Canonicalize storage roots and reject managed symlinks

**Decision**: Create or inspect the configured root, reject a symlink root, canonicalize it with
`realpath`, and ensure each managed directory is an actual non-symlink directory on the same device.
Return only canonical absolute paths.

**Rationale**: Lexical `resolve()` does not establish where an existing symlink points. A canonical
root makes all later containment comparisons stable and prevents managed directories from silently
crossing the storage boundary.

**Alternatives considered**: Supporting symlink roots makes later replacement and recovery harder to
reason about. Descriptor-relative `openat2` would be stronger against same-user hostile races but is
not directly available through maintained Node APIs and exceeds this self-hosted single-owner threat
model.

## Decision 10: Verify with automation first and the available Browser plugin last

**Decision**: Run focused architecture/path tests, then full repository/reference/performance gates,
start the updated app on a free localhost port, and inspect key desktop/mobile journeys with the
in-app Browser. Chrome is additional evidence only when its extension is available.

**Rationale**: Mechanical import changes have broad compile reach, while browser checks catch route,
asset and interaction failures not visible to static tools. The existing Docker preview on port 4321
must remain untouched.

**Alternatives considered**: Playwright alone does not satisfy the explicit Browser request.
Browser-only checks without automated suites cannot validate hostile path and worker invariants; an
unavailable Chrome store item cannot be repaired or substituted by repository code.
