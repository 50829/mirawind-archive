# Filesystem Boundary Contract

## Internal Relative Paths

Accepted paths are non-empty, canonical POSIX relative paths. Every component is non-empty and is
neither `.` nor `..`; backslashes, NUL/control characters and absolute or Windows drive prefixes are
rejected. Resolution may name a not-yet-created output but must remain lexically below the canonical
root.

## Archive Paths

ZIP names are decoded as strict UTF-8, converted to POSIX separators and normalized to NFC before
limits and collisions are checked. Absolute, UNC, drive-absolute, drive-relative, traversal, empty,
control-character, over-depth, over-component and over-path inputs are rejected. File/directory
prefix conflicts and case-fold collisions reject the whole archive.

An explicit directory may follow an already inferred directory prefix. A file may never replace an
explicit or inferred directory, and a directory may never replace a file.

## Inspection and Extraction

The second ZIP directory read must have exactly the inspected entry count and per-index identity.
Identity includes normalized path, directory flag, compression method, compressed/uncompressed sizes,
signature and encryption state. A mismatch occurs before target creation for that entry. Any failure
removes the fresh extraction destination.

## Storage and Writes

The configured storage root and all managed directories are non-symlink directories. Returned layout
paths are canonical and on one filesystem. Atomic replacement creates an exclusive no-follow
temporary sibling, writes and syncs it, renames it over the target, then syncs the parent. Any failure
before rename closes and removes the temporary sibling.

## Residual Threat Boundary

The approved deployment is a single-owner Linux host. These checks defend hostile imported content,
corrupt persisted paths and accidental symlinks. They do not claim protection from a privileged or
same-UID attacker continuously replacing parent directories; stronger descriptor-relative `openat2`
semantics would require a separately approved native boundary.
