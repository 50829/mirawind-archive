# Data Model: Clean-slate Publishing and Reading

## Import

- Opaque import ID, optional stable target book ID and retained original ZIP reference.
- State advances through uploaded, analysis/confirmation, preparation and draft-ready or a
  terminal rejected/canceled state.
- The status projection includes candidate confirmation, current job and preview state from
  one database snapshot.

## Background Job

- Kind selects a closed phase set.
- Progress is `completed`, nullable `total`, `unit` and nullable `processed_bytes`.
- Cancellation request time is durable. Terminal failure retains the last accepted phase
  and progress.
- One leased job executes in a terminable child process.

## Book Configuration Revision

- Immutable pair of book ID and increasing revision.
- Points to one accepted source snapshot and strict v3 configuration.
- Structure nodes are keyed by stable block ID.
- Source regions are keyed by stable region ID and retain an explicit `applied` state so
  disabling a region does not erase its definition.

## Draft Preview

- Immutable pair of book ID and configuration revision.
- Captures source, configuration, compiler, renderer and semantic identities.
- Transitions `building -> ready|failed`; only the current ready revision is readable.
- Derived files include pages, resources, diagnostics and the bounded workbench model.

## Reader Page Model

- Book/page identity, title, hierarchical TOC, breadcrumbs, page outline, body, previous and
  next links, downloads and mode capabilities.
- `published` enables public search/download; `preview` disables them and adds only bounded
  revision metadata for the sandbox runtime.

## Published Version

- Immutable directory containing strict version marker v2, document manifest v2, page HTML,
  resources and search spool.
- `current_version_id` is the only visibility pointer.
- A ready version becomes current only after file, manifest, projection and search
  validation complete.

## Preview Resource Authorization

- Signed claims: version, session ID, administrator ID, book ID, configuration revision,
  resource ID and expiry.
- Maximum lifetime is one hour and never exceeds session expiry.
- Authorization is valid only while the session exists, the user remains the sole
  administrator, the book is active and the revision remains current and ready.
