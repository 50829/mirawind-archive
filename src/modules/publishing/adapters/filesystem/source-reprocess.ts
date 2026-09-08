import type Database from "better-sqlite3";
import type { StorageLayout } from "@/platform/filesystem/storage-layout";
import { queueDraftSave } from "./queue-draft-save";

export function queueSourceReprocess(input: {
  readonly bookId: number;
  readonly database: Database.Database;
  readonly layout: StorageLayout;
  readonly expectedUpdatedAt: number;
  readonly nowMs: number;
  readonly profile: "verbatim-v1" | "zh-smart-v2";
}) {
  return queueDraftSave({
    ...input,
    patch: { kind: "reprocess", typography_profile: input.profile },
    internal: true,
  });
}
