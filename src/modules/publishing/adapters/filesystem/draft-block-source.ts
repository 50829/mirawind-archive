import { createHash } from "node:crypto";
import {
  chmod,
  constants,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
} from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import type Database from "better-sqlite3";

import { SafeApplicationError } from "@/domain/errors";
import { DraftRepository } from "@/modules/publishing/adapters/sqlite/drafts";
import { SourceRepository } from "@/modules/publishing/adapters/sqlite/sources";
import {
  parsePrintedContentsAnalysisV2,
  type PrintedContentsAnalysisV2,
} from "@/modules/publishing/core/preparation/printed-contents-analysis";
import { parseBookConfigYaml } from "@/modules/publishing/core/publication/book-config-schema";
import { canonicalJson } from "@/modules/publishing/core/publication/manifest";
import {
  atomicWriteFile,
  resolveContainedPath,
  type StorageLayout,
} from "@/platform/filesystem/layout";

export const maximumDraftSourceBytes = 256 * 1024 * 1024;

export interface CurrentDraftContext {
  readonly book: ReturnType<DraftRepository["requireBook"]>;
  readonly config: Readonly<Record<string, unknown>>;
  readonly configRecord: ReturnType<DraftRepository["requireConfig"]>;
  readonly markdown: string;
  readonly source: ReturnType<SourceRepository["requireSnapshot"]>;
}

export interface CurrentDraftBlockContext extends CurrentDraftContext {
  readonly block: {
    readonly block_id: string;
    readonly end_offset: number;
    readonly kind: string;
    readonly start_offset: number;
    readonly text_fingerprint: string;
  };
}

export function draftSourceSha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function relativeDraftStoragePath(root: string, target: string): string {
  const result = relative(root, target).split(sep).join("/");
  if (!result || result === ".." || result.startsWith("../")) {
    throw new Error("SOURCE_EDIT_STORAGE_PATH_INVALID");
  }
  return result;
}

export function draftSourceConfig(
  config: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return config.source as Readonly<Record<string, unknown>>;
}

export async function readCurrentDraft(input: {
  readonly bookId: number;
  readonly database: Database.Database;
  readonly layout: StorageLayout;
}): Promise<CurrentDraftContext> {
  const drafts = new DraftRepository(input.database);
  const book = drafts.findBook(input.bookId);
  if (!book?.draftConfigRevision || !book.draftSourceId) {
    throw new SafeApplicationError(
      "NOT_FOUND",
      "The draft block was not found.",
      404,
    );
  }
  const configRecord = drafts.requireConfig(
    input.bookId,
    book.draftConfigRevision,
  );
  const config = parseBookConfigYaml(
    await readFile(
      await resolveContainedPath(
        input.layout.root,
        configRecord.yamlRelativePath,
      ),
      "utf8",
    ),
  );
  const source = new SourceRepository(input.database).requireSnapshot(
    book.draftSourceId,
  );
  const sourceValue = draftSourceConfig(config);
  if (
    source.mainMarkdownPath !== sourceValue.main_markdown ||
    source.mainMarkdownSha256 !== sourceValue.main_markdown_sha256
  ) {
    throw new Error("DRAFT_SOURCE_CAPTURE_MISMATCH");
  }
  const markdownPath = await resolveContainedPath(
    await resolveContainedPath(
      input.layout.root,
      source.sourceRootRelativePath,
    ),
    source.mainMarkdownPath,
  );
  if ((await stat(markdownPath)).size > maximumDraftSourceBytes) {
    throw new SafeApplicationError(
      "DRAFT_SOURCE_TOO_LARGE",
      "The draft source is too large to edit.",
      413,
    );
  }
  const markdown = await readFile(markdownPath, "utf8");
  if (draftSourceSha256(markdown) !== source.mainMarkdownSha256) {
    throw new Error("DRAFT_SOURCE_HASH_MISMATCH");
  }
  return Object.freeze({
    book,
    config,
    configRecord,
    markdown,
    source,
  });
}

export async function readCurrentDraftBlock(input: {
  readonly blockId: string;
  readonly bookId: number;
  readonly database: Database.Database;
  readonly layout: StorageLayout;
}): Promise<CurrentDraftBlockContext> {
  const current = await readCurrentDraft(input);
  const blocks = draftSourceConfig(current.config)
    .blocks as CurrentDraftBlockContext["block"][];
  const block = blocks.find((item) => item.block_id === input.blockId);
  if (!block || block.kind === "heading") {
    throw new SafeApplicationError(
      "NOT_FOUND",
      "The draft block was not found.",
      404,
    );
  }
  return Object.freeze({ ...current, block });
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function lockDirectories(path: string): Promise<void> {
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) await lockDirectories(resolve(path, entry.name));
  }
  await chmod(path, 0o500);
}

export async function materializeEditedDraftSource(input: {
  readonly bindings: readonly {
    readonly id: string;
    readonly logicalPath: string;
    readonly storageRelativePath: string;
  }[];
  readonly finalRoot: string;
  readonly layout: StorageLayout;
  readonly mainMarkdownPath: string;
  readonly markdown: string;
  readonly stagingRoot: string;
}): Promise<void> {
  await mkdir(input.stagingRoot, { mode: 0o700, recursive: false });
  const mainPath = await resolveContainedPath(
    input.stagingRoot,
    input.mainMarkdownPath,
  );
  await atomicWriteFile(mainPath, input.markdown, { mode: 0o400 });
  for (const binding of input.bindings) {
    const assetPath = await resolveContainedPath(
      input.layout.root,
      binding.storageRelativePath,
    );
    const metadata = await lstat(assetPath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error("SOURCE_ASSET_NOT_REGULAR_FILE");
    }
    const target = await resolveContainedPath(
      input.stagingRoot,
      binding.logicalPath,
    );
    if (target === mainPath) throw new Error("SOURCE_ASSET_PATH_CONFLICT");
    await mkdir(dirname(target), { mode: 0o700, recursive: true });
    await link(assetPath, target);
  }
  await mkdir(dirname(input.finalRoot), { mode: 0o700, recursive: true });
  await rename(input.stagingRoot, input.finalRoot);
  await lockDirectories(input.finalRoot);
  await syncDirectory(dirname(input.finalRoot));
}

export async function cloneDraftAnalysis(input: {
  readonly currentPath: string;
  readonly nextPath: string;
  readonly revision: number;
  readonly sourceId: string;
  readonly sourceSha256: string;
}): Promise<void> {
  const current = parsePrintedContentsAnalysisV2(
    JSON.parse(await readFile(input.currentPath, "utf8")),
  );
  const next = parsePrintedContentsAnalysisV2({
    ...current,
    config_revision: input.revision,
    source_id: input.sourceId,
    source_sha256: input.sourceSha256,
    typography: { risk_summaries: [], truncated: false },
  } satisfies PrintedContentsAnalysisV2);
  await atomicWriteFile(input.nextPath, canonicalJson(next), { mode: 0o400 });
}
