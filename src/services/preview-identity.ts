import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { compilerIdentity } from "../compiler/document/manifest.js";
import type { SemanticCompilationIdentity } from "../compiler/document/types.js";
import type {
  BookRecord,
  ConfigRevisionRecord,
  DraftPreviewRecord,
} from "../db/repositories/drafts.js";
import type { SourceSnapshotRecord } from "../db/repositories/sources.js";
import { SafeApplicationError } from "../domain/errors.js";
import { previewBuildVersion } from "../jobs/handlers/build-preview.js";
import { resolveContainedPath, type StorageLayout } from "../storage/layout.js";

const maximumPreviewModelBytes = 8 * 1024 * 1024;

function stale(): never {
  throw new SafeApplicationError(
    "PUBLISH_PREVIEW_STALE",
    "The ready preview no longer matches the current publishing inputs.",
    409,
  );
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) stale();
  return value as Readonly<Record<string, unknown>>;
}

export async function assertReadyPreviewIdentity(input: {
  readonly book: BookRecord;
  readonly config: ConfigRevisionRecord;
  readonly layout: StorageLayout;
  readonly preview: DraftPreviewRecord;
  readonly source: SourceSnapshotRecord;
}): Promise<SemanticCompilationIdentity> {
  if (
    input.book.draftConfigRevision !== input.config.revision ||
    input.book.readyPreviewRevision !== input.config.revision ||
    input.book.draftSourceId !== input.source.id ||
    input.config.sourceId !== input.source.id ||
    input.preview.configRevision !== input.config.revision ||
    input.preview.sourceId !== input.source.id ||
    input.preview.state !== "ready" ||
    !input.preview.previewRelativePath
  ) {
    stale();
  }

  try {
    const previewRoot = await resolveContainedPath(
      input.layout.root,
      input.preview.previewRelativePath,
    );
    const modelPath = resolve(previewRoot, "preview-model.json");
    const metadata = await stat(modelPath);
    if (
      !metadata.isFile() ||
      metadata.size < 2 ||
      metadata.size > maximumPreviewModelBytes
    ) {
      stale();
    }
    const model = record(JSON.parse(await readFile(modelPath, "utf8")));
    if (
      model.version !== previewBuildVersion ||
      model.config_revision !== input.config.revision ||
      model.source_sha256 !== input.source.mainMarkdownSha256 ||
      model.config_sha256 !== input.config.yamlSha256 ||
      model.compiler_version !== compilerIdentity.version ||
      model.renderer_version !== compilerIdentity.renderer_version ||
      typeof model.semantic_digest !== "string" ||
      !/^[a-f0-9]{64}$/u.test(model.semantic_digest)
    ) {
      stale();
    }
    return Object.freeze({
      compiler_version: compilerIdentity.version,
      config_sha256: input.config.yamlSha256,
      renderer_version: compilerIdentity.renderer_version,
      semantic_digest: model.semantic_digest,
      source_sha256: input.source.mainMarkdownSha256,
    });
  } catch (error) {
    if (
      error instanceof SafeApplicationError &&
      error.code === "PUBLISH_PREVIEW_STALE"
    ) {
      throw error;
    }
    stale();
  }
}
