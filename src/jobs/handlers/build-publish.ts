import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import type Database from "better-sqlite3";

import {
  buildImmutableVersion,
  readVersionBuildArtifact,
} from "../../compiler/version-builder.js";
import { parseSearchSpool } from "../../compiler/search/build-spool.js";
import { VersionRepository } from "../../db/repositories/versions.js";
import type { CrashPointInjector } from "../crash-points.js";
import { injectCrashPoint } from "../crash-points.js";
import {
  validateDocumentManifest,
  validateVersionMarker,
} from "../../schemas/document-manifest.js";
import { deriveBookVersionPresentation } from "../../services/book-presentation.js";
import { publishReadyVersion } from "../../services/publication.js";
import { finalizeImmutableVersion } from "../../storage/finalize-version.js";
import type { StorageLayout } from "../../storage/layout.js";

export function versionIdForPublishJob(jobId: string): string {
  return `ver_${createHash("sha256")
    .update("mirawind-publish-job-version-v1\0")
    .update(jobId)
    .digest("base64url")
    .slice(0, 24)}`;
}

export async function buildPublish(input: {
  readonly bookId: number;
  readonly configRevision: number;
  readonly configYamlPath: string;
  readonly createdAtMs: number;
  readonly draftRoot: string;
  readonly jobId: string;
  readonly predecessorVersionId: string | null;
  readonly sourceId: string;
  readonly sourceRoot: string;
  readonly stagingDirectory: string;
}): Promise<void> {
  await buildImmutableVersion({
    bookId: input.bookId,
    configRevision: input.configRevision,
    configYamlPath: input.configYamlPath,
    createdAtMs: input.createdAtMs,
    draftRoot: input.draftRoot,
    predecessorVersionId: input.predecessorVersionId,
    sourceId: input.sourceId,
    sourceRoot: input.sourceRoot,
    stagingDirectory: input.stagingDirectory,
    versionId: versionIdForPublishJob(input.jobId),
  });
}

export async function finalizeBuiltPublication(input: {
  readonly actorUserId: string | null;
  readonly crashPoint?: CrashPointInjector;
  readonly database: Database.Database;
  readonly jobId: string;
  readonly layout: StorageLayout;
  readonly leaseOwner: string;
  readonly nowMs: number;
  readonly stagingDirectory: string;
}): Promise<string> {
  const artifact = await readVersionBuildArtifact(input.stagingDirectory);
  const finalDirectory = await finalizeImmutableVersion({
    artifact,
    ...(input.crashPoint ? { crashPoint: input.crashPoint } : {}),
    layout: input.layout,
    stagingDirectory: input.stagingDirectory,
  });
  const marker = validateVersionMarker(
    JSON.parse(await readFile(resolve(finalDirectory, "version.json"), "utf8")),
  );
  const manifest = validateDocumentManifest(
    JSON.parse(
      await readFile(resolve(finalDirectory, "document-manifest.json"), "utf8"),
    ),
  );
  const presentation = deriveBookVersionPresentation({
    bookConfig: await readFile(resolve(finalDirectory, "book.yaml"), "utf8"),
    createdAtMs: Date.parse(String(marker.created_at)),
    documentManifest: manifest,
  });
  const spoolJson = await readFile(
    resolve(finalDirectory, "derived", "search-spool.json"),
    "utf8",
  );
  const spool = parseSearchSpool(spoolJson);
  const blocks = manifest.blocks as Record<
    string,
    Readonly<Record<string, unknown>>
  >;
  await injectCrashPoint(input.crashPoint, "before_ready_search");
  const ftsStartedAt = performance.now();
  new VersionRepository(input.database).registerReadyWithSearch({
    bookId: Number(marker.book_id),
    compilerVersion: String(
      (marker.compiler as Readonly<Record<string, unknown>>).version,
    ),
    completeAtMs: input.nowMs,
    configRevision: Number(marker.config_revision),
    createdByJobId: input.jobId,
    expectedSearchBlockIds: Object.entries(blocks)
      .filter(([, block]) => String(block.normalized_visible_text).trim())
      .map(([blockId]) => blockId),
    manifestSchemaVersion: Number(manifest.schema_version),
    manifestSha256: String(marker.manifest_sha256),
    predecessorVersionId:
      typeof marker.predecessor_version_id === "string"
        ? marker.predecessor_version_id
        : null,
    presentation,
    rendererVersion: String(
      (marker.compiler as Readonly<Record<string, unknown>>).renderer_version,
    ),
    sourceId: String(marker.source_id),
    spool,
    versionId: String(marker.version_id),
    versionRelativePath: relative(input.layout.root, finalDirectory)
      .split(sep)
      .join("/"),
  });
  const ftsBuildMs =
    Math.round((performance.now() - ftsStartedAt) * 1_000) / 1_000;
  await injectCrashPoint(input.crashPoint, "after_ready_search");
  const markerFiles = marker.files as readonly {
    readonly path: string;
    readonly size: number;
  }[];
  const markerSize = (await stat(resolve(finalDirectory, "version.json"))).size;
  await publishReadyVersion({
    actorUserId: input.actorUserId,
    ...(input.crashPoint ? { crashPoint: input.crashPoint } : {}),
    database: input.database,
    jobId: input.jobId,
    leaseOwner: input.leaseOwner,
    nowMs: input.nowMs,
    progress: {
      fts_build_ms: ftsBuildMs,
      output_bytes:
        markerSize + markerFiles.reduce((total, file) => total + file.size, 0),
      output_files: markerFiles.length + 1,
      search_fts_rows: spool.ftsRows.length,
      search_short_rows: spool.shortRows.length,
      search_spool_bytes: Buffer.byteLength(spoolJson, "utf8"),
    },
    versionId: String(marker.version_id),
  });
  return String(marker.version_id);
}
