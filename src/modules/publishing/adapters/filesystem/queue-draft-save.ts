import type Database from "better-sqlite3";
import { SafeApplicationError } from "@/domain/errors";
import type { StorageLayout } from "@/platform/filesystem/storage-layout";
import { parseDraftEdit } from "../../core/content/edit-book";
import { maximumContentTimestamp } from "../../core/content/book-document";
import { DraftSaveRepository } from "../sqlite/draft-saves";
import { requireDraftTimestamp } from "./draft-document";

export function queueDraftSave(input: {
  readonly bookId: number;
  readonly database: Database.Database;
  readonly layout: StorageLayout;
  readonly expectedUpdatedAt: number;
  readonly patch: unknown;
  readonly nowMs: number;
  readonly internal?: boolean;
}) {
  if (
    !Number.isSafeInteger(input.expectedUpdatedAt) ||
    input.expectedUpdatedAt < 0 ||
    input.expectedUpdatedAt > maximumContentTimestamp
  )
    throw new SafeApplicationError(
      "DRAFT_TIMESTAMP_INVALID",
      "A valid draft timestamp is required.",
      400,
    );
  const patch = input.internal ? input.patch : parseDraftEdit(input.patch);
  const job = new DraftSaveRepository(input.database).enqueue({
    bookId: input.bookId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    patch,
    nowMs: input.nowMs,
    assertCurrent: () => {
      requireDraftTimestamp(
        input.layout,
        input.bookId,
        input.expectedUpdatedAt,
      );
    },
  });
  return {
    job_id: job.id,
    state: "queued" as const,
    expected_updated_at: input.expectedUpdatedAt,
  };
}
