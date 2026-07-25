import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import type Database from "better-sqlite3";
import { stringify } from "yaml";

import { prepareConfiguredDocument } from "../compiler/document/configured-document.js";
import { DraftRepository } from "../db/repositories/drafts.js";
import { SourceRepository } from "../db/repositories/sources.js";
import { SafeApplicationError } from "../domain/errors.js";
import { createStrongEtag } from "../http/cache/policies.js";
import {
  migrateBookConfigToCurrent,
  parseBookConfigYaml,
} from "../schemas/book-config.js";
import {
  atomicWriteFile,
  resolveContainedPath,
  type StorageLayout,
} from "../storage/layout.js";

const maximumConfigBytes = 4 * 1024 * 1024;

interface ConfigStructureNode {
  readonly block_id: string;
}

function dataRelativePath(root: string, target: string): string {
  const result = relative(root, target).split(sep).join("/");
  if (!result || result === ".." || result.startsWith("../")) {
    throw new Error("CONFIG_STORAGE_PATH_INVALID");
  }
  return result;
}

function structures(
  config: Readonly<Record<string, unknown>>,
): readonly ConfigStructureNode[] {
  return config.structure as readonly ConfigStructureNode[];
}

function sourceConfig(
  config: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return config.source as Readonly<Record<string, unknown>>;
}

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export interface ConfigRevisionUpdate {
  readonly config: Readonly<Record<string, unknown>>;
  readonly etag: string;
  readonly jobId: string;
  readonly revision: number;
}

export async function replaceDraftConfig(input: {
  readonly bookId: number;
  readonly config: unknown;
  readonly database: Database.Database;
  readonly expectedEtag: string | null;
  readonly layout: StorageLayout;
  readonly nowMs: number;
}): Promise<ConfigRevisionUpdate> {
  const drafts = new DraftRepository(input.database);
  const book = drafts.findBook(input.bookId);
  if (!book?.draftConfigRevision || !book.draftSourceId) {
    throw new SafeApplicationError(
      "NOT_FOUND",
      "The draft was not found.",
      404,
    );
  }
  const current = drafts.requireConfig(input.bookId, book.draftConfigRevision);
  if (
    !input.expectedEtag ||
    input.expectedEtag !== createStrongEtag(current.yamlSha256)
  ) {
    throw new SafeApplicationError(
      "DRAFT_PRECONDITION_FAILED",
      "The draft changed since it was read.",
      412,
    );
  }
  const next = migrateBookConfigToCurrent(input.config);
  if (next.book_id !== input.bookId || next.revision !== current.revision + 1) {
    throw new SafeApplicationError(
      "CONFIG_REVISION_INVALID",
      "The replacement configuration has an invalid identity or revision.",
      409,
    );
  }
  const currentPath = await resolveContainedPath(
    input.layout.root,
    current.yamlRelativePath,
  );
  const currentConfig = migrateBookConfigToCurrent(
    parseBookConfigYaml(await readFile(currentPath, "utf8")),
  );
  if (!equalJson(sourceConfig(currentConfig), sourceConfig(next))) {
    throw new SafeApplicationError(
      "CONFIG_SOURCE_IMMUTABLE",
      "A configuration revision cannot change its accepted source.",
      409,
    );
  }
  const source = new SourceRepository(input.database).requireSnapshot(
    book.draftSourceId,
  );
  const sourceRoot = await resolveContainedPath(
    input.layout.root,
    source.sourceRootRelativePath,
  );
  const markdownPath = await resolveContainedPath(
    sourceRoot,
    source.mainMarkdownPath,
  );
  const markdownBytes = await readFile(markdownPath);
  if (
    createHash("sha256").update(markdownBytes).digest("hex") !==
    source.mainMarkdownSha256
  ) {
    throw new SafeApplicationError(
      "SOURCE_HASH_MISMATCH",
      "The accepted source failed integrity validation.",
      409,
    );
  }
  const yaml = stringify(next, { lineWidth: 0 });
  if (Buffer.byteLength(yaml, "utf8") > maximumConfigBytes) {
    throw new SafeApplicationError(
      "BOOK_CONFIG_TOO_LARGE",
      "The book configuration is too large.",
      400,
    );
  }
  const yamlSha256 = createHash("sha256").update(yaml).digest("hex");
  prepareConfiguredDocument({
    config: next,
    configSha256: yamlSha256,
    markdownBytes,
    sourceHeadingBlockIds: structures(currentConfig).map(
      (heading) => heading.block_id,
    ),
  });
  const revisionDirectory = resolve(
    input.layout.bookDirectory,
    String(input.bookId),
    "draft",
    "configs",
    String(next.revision),
  );
  const yamlPath = resolve(revisionDirectory, "book.yaml");
  await mkdir(dirname(revisionDirectory), { mode: 0o700, recursive: true });
  try {
    await mkdir(revisionDirectory, { mode: 0o700, recursive: false });
  } catch {
    throw new SafeApplicationError(
      "DRAFT_PRECONDITION_FAILED",
      "The draft changed since it was read.",
      412,
    );
  }
  try {
    await atomicWriteFile(yamlPath, yaml, { mode: 0o600 });
    await chmod(yamlPath, 0o400);
    const selected = drafts.replaceConfigAndQueuePreview({
      alias: typeof next.alias === "string" ? next.alias : null,
      bookId: input.bookId,
      expectedRevision: current.revision,
      expectedYamlSha256: current.yamlSha256,
      nowMs: input.nowMs,
      revision: Number(next.revision),
      schemaVersion: Number(next.schema_version),
      sourceId: book.draftSourceId,
      title: String(next.title),
      yamlRelativePath: dataRelativePath(input.layout.root, yamlPath),
      yamlSha256,
    });
    return Object.freeze({
      config: next,
      etag: createStrongEtag(yamlSha256),
      jobId: selected.jobId,
      revision: selected.config.revision,
    });
  } catch (error) {
    await rm(revisionDirectory, { force: true, recursive: true });
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
