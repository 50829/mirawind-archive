import type Database from "better-sqlite3";

import { SafeApplicationError } from "@/domain/errors";
import { withImmediateTransaction } from "@/platform/sqlite/immediate-transaction";

export function makeBookNonPublic(input: {
  readonly actorUserId: string | null;
  readonly bookId: number;
  readonly database: Database.Database;
  readonly nowMs: number;
  readonly visibility: "draft" | "private";
}): void {
  withImmediateTransaction(input.database, () => {
    const changed = input.database
      .prepare(
        `UPDATE books SET visibility = ?, updated_at = ?
         WHERE id = ? AND deletion_requested_at IS NULL`,
      )
      .run(input.visibility, input.nowMs, input.bookId);
    if (changed.changes !== 1) {
      throw new SafeApplicationError(
        "NOT_FOUND",
        "The book was not found.",
        404,
      );
    }
    input.database
      .prepare(
        `INSERT INTO audit_events (
          actor_user_id, action, book_id, version_id, job_id,
          safe_metadata_json, created_at
        ) VALUES (?, 'book.visibility.changed', ?, NULL, NULL, ?, ?)`,
      )
      .run(
        input.actorUserId,
        input.bookId,
        JSON.stringify({ visibility: input.visibility }),
        input.nowMs,
      );
  });
}
