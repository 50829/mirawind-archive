import type Database from "better-sqlite3";
import type { StorageLayout } from "@/platform/filesystem/storage-layout";
import { draftDocumentPath, readDraftHeader } from "./draft-document";
import { isOpaqueId } from "@/domain/ids";

export function retainedDraftSaveFiles(
  database: Database.Database,
  layout: StorageLayout,
) {
  const rows = database
    .prepare(
      `SELECT request.job_id,request.book_id,request.expected_updated_at,
      request.accepted_updated_at,request.prepared_path,jobs.state,
      CASE WHEN json_extract(request.payload_json,'$.kind')='cover'
        THEN json_extract(request.payload_json,'$.resource_id') END AS cover_id
    FROM save_draft_requests request JOIN jobs ON jobs.id=request.job_id
    JOIN books ON books.id=request.book_id`,
    )
    .all() as {
    job_id: string;
    book_id: number;
    expected_updated_at: number;
    accepted_updated_at: number | null;
    prepared_path: string | null;
    state: string;
    cover_id: string | null;
  }[];
  const completed = new Set(
    rows
      .filter((row) => row.state === "succeeded")
      .map((row) => row.prepared_path),
  );
  const timestamps = new Map<number, number | null>();
  const receipts = new Set<string>();
  const covers = new Set<string>();
  for (const row of rows) {
    if (!timestamps.has(row.book_id)) {
      try {
        timestamps.set(
          row.book_id,
          readDraftHeader(draftDocumentPath(layout, row.book_id), row.book_id)
            .updated_at,
        );
      } catch {
        timestamps.set(row.book_id, null);
      }
    }
    const active = row.state === "queued" || row.state === "running";
    const timestamp = timestamps.get(row.book_id);
    const retryable =
      row.state !== "succeeded" &&
      (!row.prepared_path || !completed.has(row.prepared_path)) &&
      (timestamp === null ||
        timestamp === row.expected_updated_at ||
        timestamp === row.accepted_updated_at);
    if (!active && !retryable) continue;
    receipts.add(`books/${row.book_id}/draft/saves/${row.job_id}`);
    if (row.prepared_path)
      receipts.add(row.prepared_path.replace(/\/book\.json$/u, ""));
    if (row.cover_id && isOpaqueId("resource", row.cover_id))
      covers.add(`tmp/covers/${row.cover_id}`);
  }
  return { receipts, covers };
}
