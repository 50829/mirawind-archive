import type Database from "better-sqlite3";

import type {
  BookAccessPort,
  BookAccess,
} from "../../application/commands/set-book-access";
import { withImmediateTransaction } from "@/platform/sqlite/immediate-transaction";

export class SqliteBookAccessRepository implements BookAccessPort {
  constructor(private readonly database: Database.Database) {}

  setAccess(input: {
    readonly access: BookAccess;
    readonly actorUserId: string | null;
    readonly bookId: number;
    readonly nowMs: number;
  }): "not_found" | "publication_required" | "updated" {
    return withImmediateTransaction(this.database, () => {
      const changed = this.database
        .prepare(
          `UPDATE books SET access = ?, updated_at = ?
           WHERE id = ? AND deletion_requested_at IS NULL
             AND (? = 'private' OR current_version_id IS NOT NULL)`,
        )
        .run(input.access, input.nowMs, input.bookId, input.access);
      if (changed.changes !== 1) {
        const book = this.database
          .prepare(
            `SELECT current_version_id FROM books
             WHERE id = ? AND deletion_requested_at IS NULL`,
          )
          .get(input.bookId) as
          { current_version_id: string | null } | undefined;
        return book && input.access === "public"
          ? "publication_required"
          : "not_found";
      }
      this.database
        .prepare(
          `INSERT INTO audit_events (
            actor_user_id, action, book_id, version_id, job_id,
            safe_metadata_json, created_at
          ) VALUES (?, 'book.access.changed', ?, NULL, NULL, ?, ?)`,
        )
        .run(
          input.actorUserId,
          input.bookId,
          JSON.stringify({ access: input.access }),
          input.nowMs,
        );
      return "updated";
    });
  }
}
