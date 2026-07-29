import { mkdir, rename, rm } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import type Database from "better-sqlite3";

import { DraftRepository } from "@/modules/publishing/adapters/sqlite/drafts";
import type { PreviewBuildArtifact } from "@/modules/publishing/adapters/worker/preview-artifact";
import { previewBuildVersion } from "@/modules/publishing/adapters/worker/preview-artifact";
import {
  resolveContainedPath,
  type StorageLayout,
} from "@/platform/filesystem/layout";

function dataRelativePath(root: string, target: string): string {
  const result = relative(root, target).split(sep).join("/");
  if (!result || result === ".." || result.startsWith("../")) {
    throw new Error("PREVIEW_STORAGE_PATH_INVALID");
  }
  return result;
}

export async function finalizeBuiltPreview(input: {
  readonly artifact: PreviewBuildArtifact;
  readonly bookId: number;
  readonly configRevision: number;
  readonly database: Database.Database;
  readonly layout: StorageLayout;
  readonly nowMs: number;
  readonly stagingDirectory: string;
}): Promise<void> {
  if (input.artifact.version !== previewBuildVersion) {
    throw new Error("PREVIEW_BUILD_ARTIFACT_INVALID");
  }
  const finalDirectory = resolve(
    input.layout.bookDirectory,
    String(input.bookId),
    "draft",
    "previews",
    String(input.configRevision),
  );
  const stagedPreviewDirectory = await resolveContainedPath(
    input.stagingDirectory,
    input.artifact.previewRelativePath,
  );
  await mkdir(resolve(finalDirectory, ".."), { mode: 0o700, recursive: true });
  try {
    await rename(stagedPreviewDirectory, finalDirectory);
    const diagnosticsPath = resolve(
      finalDirectory,
      input.artifact.diagnosticsRelativePath,
    );
    new DraftRepository(input.database).completePreview({
      bookId: input.bookId,
      configRevision: input.configRevision,
      diagnosticsRelativePath: dataRelativePath(
        input.layout.root,
        diagnosticsPath,
      ),
      nowMs: input.nowMs,
      previewRelativePath: dataRelativePath(input.layout.root, finalDirectory),
    });
  } catch (error) {
    await rm(finalDirectory, { force: true, recursive: true });
    throw error;
  }
}
