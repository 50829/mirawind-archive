# Contributing

Read `AGENTS.md`, the constitution, decision log, product specification, and the active
feature artifacts before changing implementation. If a product or technical decision
changes, update the decision log and affected specifications before the code.

## Commit messages

Every commit follows Conventional Commits 1.0.0:

```text
<type>(<optional-scope>): <description>
```

Allowed types are `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`,
and `revert`. Preferred scopes are `auth`, `import`, `archive`, `compiler`, `manifest`,
`publish`, `reader`, `search`, `worker`, `storage`, `cli`, `schemas`, and `docs`. A
cross-cutting change may omit the scope.

Examples:

```text
feat(import): stream uploads into durable staging
fix(publish): reject a stale config revision
test(archive): cover normalized path collisions
docs: record the publication recovery decision
```

Use `!` or a `BREAKING CHANGE:` footer for an intentional breaking change. Keep one
reviewable logical change per commit. Commit messages do not replace the decision log or
specification workflow.

The repository uses `.githooks/commit-msg` for local validation and CI validates every
pull-request commit plus the final pull-request title. After cloning, enable the managed
hooks with:

```sh
git config core.hooksPath .githooks
```

## External code and implementation references

Prefer maintained narrow dependencies. Before copying or adapting substantive external
code, verify its file-level license and add an entry to
`docs/third-party/code-provenance.md`. Record an immutable upstream tag or commit and the
exact source path. GPL, MPL, or custom-licensed application code remains behavior-only
reference material unless a later explicit decision approves reuse.
