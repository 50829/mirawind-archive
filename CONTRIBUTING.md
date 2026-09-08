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
fix(publish): reject a stale draft timestamp
test(archive): cover normalized path collisions
docs: record the publication recovery decision
```

Use `!` or a `BREAKING CHANGE:` footer for an intentional breaking change. Keep one
reviewable logical change per commit. Commit messages do not replace the decision log or
specification workflow.

## UI styling

UI tests verify behavior, not fixed copy or serialized markup. Do not add snapshots or
string assertions for headings, explanations, button labels, CSS classes, or element order.
Use browser interactions for critical workflows and assert state, requests, navigation,
accessibility, and data outcomes. Document rendering, sanitization, and private-content
isolation tests still validate their output because that output is the functional contract.

Use Tailwind CSS utilities and the shared Tailwind v4 theme. Product UI colors come only
from the approved official palette in D-106: `stone` for neutral surfaces, `emerald` for
primary interaction, `amber` for focus or caution, and `red` for danger, plus Tailwind
`white` and `black`. Do not add direct hex, RGB, HSL or OKLCH literals, page-local palettes,
or another custom color namespace. The style-token check in `pnpm lint` enforces this rule.

Complex generated-document selectors may remain in the global or reader stylesheet, but
their colors must reference Tailwind `--color-*` variables. Third-party renderer output and
import fixtures are not product UI and remain byte-preserving exceptions.

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
