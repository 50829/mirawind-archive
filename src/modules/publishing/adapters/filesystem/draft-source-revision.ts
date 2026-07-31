import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type Database from "better-sqlite3";
import { stringify } from "yaml";

import { SafeApplicationError } from "@/domain/errors";
import { createOpaqueId } from "@/domain/ids";
import { createStrongEtag } from "@/http/cache/policies";
import {
  cloneDraftAnalysis,
  draftSourceSha256,
  materializeEditedDraftSource,
  relativeDraftStoragePath,
  type CurrentDraftContext,
} from "@/modules/publishing/adapters/filesystem/draft-block-source";
import { DraftCandidateRepository } from "@/modules/publishing/adapters/sqlite/draft-candidate-repository";
import { SourceRepository } from "@/modules/publishing/adapters/sqlite/sources";
import type { StorageLayout } from "@/platform/filesystem/layout";
import { atomicWriteFile } from "@/platform/filesystem/layout";
import { removeExactContainedTree } from "@/platform/filesystem/permanent-removal";
import { withImmediateTransaction } from "@/platform/sqlite/immediate-transaction";

export interface PendingSourceAsset {
  readonly id: string;
  readonly logicalPath: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly storageRelativePath: string;
}

export interface DraftSourceRevisionUpdate {
  readonly candidate: {
    readonly attemptId: string;
    readonly jobId: string;
    readonly state: "building";
  };
  readonly etag: string;
  readonly revision: number;
}

export async function createDraftSourceRevision(input: {
  readonly additionalAssets?: readonly PendingSourceAsset[];
  readonly bookId: number;
  readonly current: CurrentDraftContext;
  readonly database: Database.Database;
  readonly layout: StorageLayout;
  readonly markdown: string;
  readonly nextConfig: Readonly<Record<string, unknown>>;
  readonly nowMs: number;
}): Promise<DraftSourceRevisionUpdate> {
  const sources = new SourceRepository(input.database);
  const existingBindings = sources.bindingsForSource(input.current.source.id);
  const additionalAssets = input.additionalAssets ?? [];
  const sourceId = createOpaqueId("source");
  const revision = input.current.configRecord.revision + 1;
  const nextSource = input.nextConfig.source as Readonly<
    Record<string, unknown>
  >;
  const nextSourceSha256 = String(nextSource.main_markdown_sha256);
  if (Number(input.nextConfig.revision) !== revision) {
    throw new Error("DRAFT_SOURCE_REVISION_MISMATCH");
  }
  if (draftSourceSha256(input.markdown) !== nextSourceSha256) {
    throw new Error("DRAFT_SOURCE_HASH_MISMATCH");
  }
  const draftRoot = resolve(
    input.layout.bookDirectory,
    String(input.bookId),
    "draft",
  );
  const stagingRoot = resolve(draftRoot, `.source-edit-${sourceId}.part`);
  const finalSourceRoot = resolve(draftRoot, "sources", sourceId);
  const configDirectory = resolve(draftRoot, "configs", String(revision));
  const configPath = resolve(configDirectory, "book.yaml");
  const analysisPath = resolve(
    draftRoot,
    "analyses",
    sourceId,
    `${revision}.json`,
  );
  let ownsConfigDirectory = false;
  try {
    await materializeEditedDraftSource({
      bindings: [...existingBindings, ...additionalAssets],
      finalRoot: finalSourceRoot,
      layout: input.layout,
      mainMarkdownPath: input.current.source.mainMarkdownPath,
      markdown: input.markdown,
      stagingRoot,
    });
    await mkdir(dirname(configDirectory), { mode: 0o700, recursive: true });
    try {
      await mkdir(configDirectory, { mode: 0o700, recursive: false });
      ownsConfigDirectory = true;
    } catch {
      throw new SafeApplicationError(
        "DRAFT_PRECONDITION_FAILED",
        "The draft changed since it was read.",
        412,
      );
    }
    const yaml = stringify(input.nextConfig, { lineWidth: 0 });
    const yamlSha256 = draftSourceSha256(yaml);
    await atomicWriteFile(configPath, yaml, { mode: 0o400 });
    await cloneDraftAnalysis({
      currentPath: resolve(
        draftRoot,
        "analyses",
        input.current.source.id,
        `${input.current.configRecord.revision}.json`,
      ),
      nextPath: analysisPath,
      revision,
      sourceId,
      sourceSha256: nextSourceSha256,
    });
    const candidate = withImmediateTransaction(input.database, () => {
      for (const asset of additionalAssets) {
        sources.registerAsset({
          bookId: input.bookId,
          id: asset.id,
          nowMs: input.nowMs,
          sha256: asset.sha256,
          sizeBytes: asset.sizeBytes,
          storageRelativePath: asset.storageRelativePath,
        });
      }
      sources.createSnapshot({
        analysisVersion: input.current.source.analysisVersion,
        bookId: input.bookId,
        id: sourceId,
        mainMarkdownPath: input.current.source.mainMarkdownPath,
        mainMarkdownSha256: nextSourceSha256,
        nowMs: input.nowMs,
        origin: "edit",
        parentSourceId: input.current.source.id,
        sourceRootRelativePath: relativeDraftStoragePath(
          input.layout.root,
          finalSourceRoot,
        ),
      });
      for (const binding of [...existingBindings, ...additionalAssets]) {
        sources.bindAsset({
          assetId: binding.id,
          logicalPath: binding.logicalPath,
          sourceId,
        });
      }
      return new DraftCandidateRepository(
        input.database,
      ).replaceSourceConfigAndCreateInCurrentTransaction({
        bookId: input.bookId,
        expectedRevision: input.current.configRecord.revision,
        expectedSourceId: input.current.source.id,
        expectedYamlSha256: input.current.configRecord.yamlSha256,
        newSourceId: sourceId,
        nowMs: input.nowMs,
        revision,
        schemaVersion: 4,
        title: String(
          (input.nextConfig.metadata as Readonly<Record<string, unknown>>)
            .title,
        ),
        yamlRelativePath: relativeDraftStoragePath(
          input.layout.root,
          configPath,
        ),
        yamlSha256,
      });
    });
    return Object.freeze({
      candidate: Object.freeze({
        attemptId: candidate.attemptId,
        jobId: candidate.jobId,
        state: "building" as const,
      }),
      etag: createStrongEtag(yamlSha256),
      revision,
    });
  } catch (error) {
    await removeExactContainedTree({
      root: input.layout.root,
      target: stagingRoot,
    });
    await removeExactContainedTree({
      root: input.layout.root,
      target: finalSourceRoot,
    });
    if (ownsConfigDirectory) {
      await rm(configDirectory, { force: true, recursive: true });
    }
    await rm(dirname(analysisPath), { force: true, recursive: true });
    if (
      error instanceof Error &&
      error.message === "CONFIG_REVISION_CONFLICT"
    ) {
      throw new SafeApplicationError(
        "DRAFT_PRECONDITION_FAILED",
        "The draft changed since it was read.",
        412,
      );
    }
    throw error;
  }
}
