import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import type Database from "better-sqlite3";
import { SafeApplicationError } from "@/domain/errors";
import { createOpaqueId } from "@/domain/ids";
import { maximumCoverUploadBytes } from "../../application/cover-upload-policy";
import type { StorageLayout } from "@/platform/filesystem/storage-layout";
import { atomicWriteFile } from "@/platform/filesystem/atomic-file";
import { requireDraftTimestamp } from "./draft-document";
import { queueDraftSave } from "./queue-draft-save";

export async function uploadDraftCover(input: {
  readonly bookId: number;
  readonly bytes: Uint8Array;
  readonly database: Database.Database;
  readonly expectedUpdatedAt: number;
  readonly filename: string;
  readonly layout: StorageLayout;
  readonly nowMs: number;
}) {
  if (
    !input.bytes.byteLength ||
    input.bytes.byteLength > maximumCoverUploadBytes
  )
    throw new SafeApplicationError(
      "COVER_SIZE_LIMIT",
      "The cover exceeds the size limit.",
      413,
    );
  requireDraftTimestamp(input.layout, input.bookId, input.expectedUpdatedAt);
  const id = createOpaqueId("resource");
  const path = "tmp/covers/" + id + "/upload";
  await atomicWriteFile(resolve(input.layout.root, path), input.bytes, {
    mode: 0o600,
  });
  try {
    return {
      ...queueDraftSave({
        ...input,
        patch: {
          kind: "cover",
          resource_id: id,
          upload_path: path,
          filename: input.filename,
        },
        internal: true,
      }),
      resource_id: id,
    };
  } catch (error) {
    await rm(resolve(input.layout.root, "tmp/covers", id), {
      recursive: true,
      force: true,
    });
    throw error;
  }
}
