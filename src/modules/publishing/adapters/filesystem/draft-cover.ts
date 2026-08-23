import { chmod, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type Database from "better-sqlite3";

import { SafeApplicationError } from "@/domain/errors";
import { createOpaqueId } from "@/domain/ids";
import { createStrongEtag } from "@/http/cache/policies";
import { maximumCoverUploadBytes } from "../../application/publishing-api";
import {
  draftSourceSha256,
  readCurrentDraft,
  relativeDraftStoragePath,
} from "./draft-block-source";
import { createDraftSourceRevision } from "./draft-source-revision";
import { validateBookConfig } from "../../core/publication/book-config-schema";
import {
  inspectRasterImage,
  type SupportedRasterFormat,
} from "../../core/publication/inspect-image";
import { validateConfiguredStructureHierarchy } from "../../core/publication/validate-config";
import type { StorageLayout } from "@/platform/filesystem/storage-layout";
import { atomicWriteFile } from "@/platform/filesystem/atomic-file";

const extensionByFormat: Readonly<Record<SupportedRasterFormat, string>> = {
  gif: "gif",
  jpeg: "jpg",
  png: "png",
  webp: "webp",
};

export async function uploadDraftCover(input: {
  readonly bookId: number;
  readonly bytes: Uint8Array;
  readonly database: Database.Database;
  readonly expectedEtag: string | null;
  readonly filename: string;
  readonly layout: StorageLayout;
  readonly nowMs: number;
}): Promise<{
  readonly candidate: {
    readonly attemptId: string;
    readonly jobId: string;
    readonly state: "building";
  };
  readonly coverPath: string;
  readonly etag: string;
  readonly revision: number;
}> {
  if (
    input.bytes.byteLength < 1 ||
    input.bytes.byteLength > maximumCoverUploadBytes
  ) {
    throw new SafeApplicationError(
      "COVER_SIZE_LIMIT",
      "The cover exceeds the 20 MiB limit.",
      413,
    );
  }
  const current = await readCurrentDraft(input);
  if (
    !input.expectedEtag ||
    input.expectedEtag !== createStrongEtag(current.configRecord.yamlSha256)
  ) {
    throw new SafeApplicationError(
      "DRAFT_PRECONDITION_FAILED",
      "The draft changed since it was read.",
      412,
    );
  }
  const inspection = await inspectRasterImage({
    bytes: input.bytes,
    filename: input.filename,
  });
  const assetId = createOpaqueId("sourceAsset");
  const coverPath = `covers/${assetId}.${extensionByFormat[inspection.format]}`;
  const finalAssetPath = resolve(
    input.layout.bookDirectory,
    String(input.bookId),
    "draft",
    "assets",
    assetId,
  );
  await mkdir(dirname(finalAssetPath), { mode: 0o700, recursive: true });
  await atomicWriteFile(finalAssetPath, input.bytes, { mode: 0o400 });
  await chmod(finalAssetPath, 0o400);
  const metadata = current.config.metadata as Readonly<Record<string, unknown>>;
  const nextConfig = validateBookConfig({
    ...current.config,
    metadata: { ...metadata, cover_path: coverPath },
    revision: current.configRecord.revision + 1,
  });
  validateConfiguredStructureHierarchy(nextConfig);
  try {
    const update = await createDraftSourceRevision({
      additionalAssets: [
        {
          id: assetId,
          logicalPath: coverPath,
          sha256: draftSourceSha256(input.bytes),
          sizeBytes: input.bytes.byteLength,
          storageRelativePath: relativeDraftStoragePath(
            input.layout.root,
            finalAssetPath,
          ),
        },
      ],
      bookId: input.bookId,
      current,
      database: input.database,
      layout: input.layout,
      markdown: current.markdown,
      nextConfig,
      nowMs: input.nowMs,
    });
    return Object.freeze({ ...update, coverPath });
  } catch (error) {
    await rm(finalAssetPath, { force: true });
    throw error;
  }
}
