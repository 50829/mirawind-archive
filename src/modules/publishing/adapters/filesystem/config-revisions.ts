import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import type Database from "better-sqlite3";
import { stringify } from "yaml";

import {
  parsePrintedContentsAnalysisV2,
  type PrintedContentsAnalysisV2,
} from "@/modules/publishing/core/preparation/printed-contents-analysis";
import { compileBook } from "@/modules/publishing/core/publication/compile-book";
import { canonicalJson } from "@/modules/publishing/core/publication/manifest";
import { DraftRepository } from "@/modules/publishing/adapters/sqlite/drafts";
import { SourceRepository } from "@/modules/publishing/adapters/sqlite/sources";
import { SafeApplicationError } from "@/domain/errors";
import { createStrongEtag } from "@/http/cache/policies";
import {
  parseBookConfigYaml,
  validateBookConfig,
} from "@/modules/publishing/core/publication/book-config-schema";
import {
  atomicWriteFile,
  resolveContainedPath,
  type StorageLayout,
} from "@/platform/filesystem/layout";

const maximumConfigBytes = 4 * 1024 * 1024;
const maximumAnalysisBytes = 4 * 1024 * 1024;

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

async function clonePrintedContentsAnalysis(input: {
  readonly bookId: number;
  readonly currentRevision: number;
  readonly layout: StorageLayout;
  readonly nextRevision: number;
  readonly sourceId: string;
  readonly sourceSha256: string;
}): Promise<string> {
  const directory = resolve(
    input.layout.bookDirectory,
    String(input.bookId),
    "draft",
    "analyses",
    input.sourceId,
  );
  let current: PrintedContentsAnalysisV2;
  try {
    const bytes = await readFile(
      resolve(directory, `${input.currentRevision}.json`),
    );
    if (bytes.byteLength > maximumAnalysisBytes) {
      throw new Error("PRINTED_CONTENTS_ANALYSIS_INVALID");
    }
    current = parsePrintedContentsAnalysisV2(
      JSON.parse(bytes.toString("utf8")),
    );
  } catch {
    throw new SafeApplicationError(
      "DRAFT_ANALYSIS_INVALID",
      "The draft analysis must be rebuilt before saving changes.",
      409,
    );
  }
  if (
    current.config_revision !== input.currentRevision ||
    current.source_id !== input.sourceId ||
    current.source_sha256 !== input.sourceSha256
  ) {
    throw new SafeApplicationError(
      "DRAFT_ANALYSIS_INVALID",
      "The draft analysis must be rebuilt before saving changes.",
      409,
    );
  }
  const next = parsePrintedContentsAnalysisV2({
    ...current,
    config_revision: input.nextRevision,
  });
  const nextPath = resolve(directory, `${input.nextRevision}.json`);
  await atomicWriteFile(nextPath, canonicalJson(next), { mode: 0o600 });
  await chmod(nextPath, 0o400);
  return nextPath;
}

export interface ConfigRevisionUpdate {
  readonly config: Readonly<Record<string, unknown>>;
  readonly etag: string;
  readonly jobId: string;
  readonly revision: number;
}

interface DraftStructureChange {
  readonly block_id: string;
  readonly display_level?: number;
  readonly display_title?: string | null;
  readonly include_in_toc?: boolean;
  readonly role?: "appendix" | "backmatter" | "body" | "frontmatter" | null;
  readonly starts_page?: boolean;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SafeApplicationError(
      "DRAFT_PATCH_INVALID",
      "The draft patch is invalid.",
      400,
    );
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new SafeApplicationError(
      "DRAFT_PATCH_INVALID",
      "The draft patch contains an unknown field.",
      400,
    );
  }
}

function parseDraftPatch(value: unknown): {
  readonly changes: readonly DraftStructureChange[];
} {
  const patch = record(value);
  exactKeys(patch, ["changes"]);
  if (!Array.isArray(patch.changes) || patch.changes.length > 20_000) {
    throw new SafeApplicationError(
      "DRAFT_PATCH_INVALID",
      "The draft patch is invalid.",
      400,
    );
  }
  const changes = patch.changes.map((item) => {
    const change = record(item);
    exactKeys(change, [
      "block_id",
      "display_level",
      "display_title",
      "include_in_toc",
      "role",
      "starts_page",
    ]);
    if (
      typeof change.block_id !== "string" ||
      (change.display_level !== undefined &&
        (!Number.isSafeInteger(change.display_level) ||
          Number(change.display_level) < 1 ||
          Number(change.display_level) > 4)) ||
      (change.display_title !== undefined &&
        change.display_title !== null &&
        (typeof change.display_title !== "string" ||
          change.display_title.length < 1 ||
          change.display_title.length > 500)) ||
      (change.include_in_toc !== undefined &&
        typeof change.include_in_toc !== "boolean") ||
      (change.starts_page !== undefined &&
        typeof change.starts_page !== "boolean") ||
      (change.role !== undefined &&
        change.role !== null &&
        !["appendix", "backmatter", "body", "frontmatter"].includes(
          String(change.role),
        ))
    ) {
      throw new SafeApplicationError(
        "DRAFT_PATCH_INVALID",
        "A structure change is invalid.",
        400,
      );
    }
    return change as unknown as DraftStructureChange;
  });
  if (
    new Set(changes.map((change) => change.block_id)).size !== changes.length
  ) {
    throw new SafeApplicationError(
      "DRAFT_PATCH_INVALID",
      "The draft patch contains duplicate identities.",
      400,
    );
  }
  return { changes };
}

export async function patchDraftConfig(input: {
  readonly bookId: number;
  readonly database: Database.Database;
  readonly expectedEtag: string | null;
  readonly layout: StorageLayout;
  readonly nowMs: number;
  readonly patch: unknown;
}): Promise<ConfigRevisionUpdate> {
  const parsed = parseDraftPatch(input.patch);
  const drafts = new DraftRepository(input.database);
  const book = drafts.findBook(input.bookId);
  if (!book?.draftConfigRevision) {
    throw new SafeApplicationError(
      "NOT_FOUND",
      "The draft was not found.",
      404,
    );
  }
  const current = drafts.requireConfig(input.bookId, book.draftConfigRevision);
  const config = parseBookConfigYaml(
    await readFile(
      await resolveContainedPath(input.layout.root, current.yamlRelativePath),
      "utf8",
    ),
  );
  const currentNodes = config.structure as readonly Record<string, unknown>[];
  const nodeIds = new Set(currentNodes.map((node) => String(node.block_id)));
  if (parsed.changes.some((change) => !nodeIds.has(change.block_id))) {
    throw new SafeApplicationError(
      "DRAFT_PATCH_ID_UNKNOWN",
      "The draft patch references an unknown identity.",
      400,
    );
  }
  const changes = new Map(
    parsed.changes.map((change) => [change.block_id, change]),
  );
  const next = {
    ...config,
    revision: Number(config.revision) + 1,
    structure: currentNodes.map((node) => {
      const change = changes.get(String(node.block_id));
      if (!change) return node;
      const updated: Record<string, unknown> = { ...node };
      for (const key of [
        "display_level",
        "include_in_toc",
        "starts_page",
      ] as const) {
        if (change[key] !== undefined) updated[key] = change[key];
      }
      for (const key of ["display_title", "role"] as const) {
        if (change[key] === null) Reflect.deleteProperty(updated, key);
        else if (change[key] !== undefined) updated[key] = change[key];
      }
      return updated;
    }),
  };
  return replaceDraftConfig({
    bookId: input.bookId,
    config: next,
    database: input.database,
    expectedEtag: input.expectedEtag,
    layout: input.layout,
    nowMs: input.nowMs,
  });
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
  const next = validateBookConfig(input.config);
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
  const currentConfig = parseBookConfigYaml(
    await readFile(currentPath, "utf8"),
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
  compileBook({
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
    await clonePrintedContentsAnalysis({
      bookId: input.bookId,
      currentRevision: current.revision,
      layout: input.layout,
      nextRevision: Number(next.revision),
      sourceId: book.draftSourceId,
      sourceSha256: source.mainMarkdownSha256,
    });
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
    await rm(
      resolve(
        input.layout.bookDirectory,
        String(input.bookId),
        "draft",
        "analyses",
        book.draftSourceId,
        `${next.revision}.json`,
      ),
      { force: true },
    );
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
