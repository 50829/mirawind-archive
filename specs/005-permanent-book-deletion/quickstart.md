# Quickstart: Permanent Book Deletion

## Prerequisites

- Node.js 24 and the repository's pnpm version.
- A disposable local data root and SQLite database.
- Never use production book storage for destructive tests.
- Use environment-managed test credentials; do not commit passwords or session secrets.

## Install and validate the baseline

```bash
pnpm install
pnpm test
pnpm build
```

## Migration checks

Run the schema/migration test suite against:

1. an empty database;
2. the checked-in schema-6 compatibility fixture;
3. a schema-7 database opened a second time.

Expected results:

- `PRAGMA user_version = 7`;
- active preexisting books have `deletion_requested_at IS NULL`;
- `PRAGMA foreign_key_check` returns no rows.

## Focused feature validation

```bash
pnpm vitest run tests/integration/deployment/development-runtime.test.ts
pnpm vitest run tests/integration/deletion/book-deletion-service.test.ts
pnpm vitest run tests/integration/deletion/permanent-book-cleanup.test.ts
pnpm vitest run tests/integration/auth/full-route-matrix.test.ts
```

## Manual disposable-data smoke test

1. Start the Web and worker with disposable storage.
2. Sign in using an environment-provided test account.
3. Import or create a disposable book and note its title and alias.
4. Open the private library, choose delete, verify the final button stays disabled until the
   exact title is entered, then confirm.
5. Verify the entry disappears immediately and the task link shows bounded cleanup status.
6. Request old public/private routes, resources, original download and search results;
   verify non-cacheable missing behavior and no `304`.
7. Verify the former alias can be assigned to another disposable book.
8. After task completion, verify no book/upload/staging files or ordinary content records
   remain and one content-free tombstone exists.

## Failure smoke test

With disposable storage only:

1. make one cleanup target temporarily non-removable;
2. request deletion and observe that the book remains hidden while the cleanup task fails
   with a safe code;
3. restore permissions and use the existing task retry action;
4. verify cleanup completes without the book becoming visible at any point.

## Full gate

```bash
pnpm test
pnpm build
pnpm playwright test
```

Validate real deletion behavior with disposable data, not fixed confirmation copy or HTML
snapshots (D-135).
