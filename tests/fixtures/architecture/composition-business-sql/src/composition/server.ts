export function currentBooks(database: {
  prepare(sql: string): { all(): unknown[] };
}): unknown[] {
  return database.prepare("SELECT id FROM books ORDER BY id").all();
}
