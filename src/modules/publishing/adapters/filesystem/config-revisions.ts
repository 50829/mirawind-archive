import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import type Database from "better-sqlite3";
import { stringify } from "yaml";

import {
  parsePrintedContentsAnalysisV2,
  type PrintedContentsAnalysisV2,
} from "@/modules/publishing/core/preparation/printed-contents-analysis";
import { canonicalJson } from "@/modules/publishing/core/publication/manifest";
import { DraftRepository } from "@/modules/publishing/adapters/sqlite/drafts";
import { DraftCandidateRepository } from "@/modules/publishing/adapters/sqlite/draft-candidate-repository";
import { SourceRepository } from "@/modules/publishing/adapters/sqlite/sources";
import { SafeApplicationError } from "@/domain/errors";
import { createStrongEtag } from "@/http/cache/policies";
import {
  parseBookConfigYaml,
  validateBookConfig,
} from "@/modules/publishing/core/publication/book-config-schema";
import type { HeadingNumberingMode } from "@/modules/publishing/core/publication/heading-presentation";
import { validateConfiguredStructureHierarchy } from "@/modules/publishing/core/publication/validate-config";
import {
  atomicWriteFile,
  resolveContainedPath,
  type StorageLayout,
} from "@/platform/filesystem/layout";

const maximumConfigBytes = 4 * 1024 * 1024;
const maximumAnalysisBytes = 4 * 1024 * 1024;

function dataRelativePath(root: string, target: string): string {
  const result = relative(root, target).split(sep).join("/");
  if (!result || result === ".." || result.startsWith("../")) {
    throw new Error("CONFIG_STORAGE_PATH_INVALID");
  }
  return result;
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
    current.source_id !== input.sourceId
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
  readonly candidate: {
    readonly attemptId: string;
    readonly jobId: string;
    readonly state: "building";
  };
  readonly config: Readonly<Record<string, unknown>>;
  readonly etag: string;
  readonly revision: number;
}

interface DraftStructureChange {
  readonly alias?: string | null;
  readonly block_id: string;
  readonly display_level?: number;
  readonly include_in_toc?: boolean;
  readonly source_number?: string | null;
  readonly starts_page?: boolean;
  readonly title_markdown?: string;
}

interface DraftPatch {
  readonly alias?: string | null;
  readonly boundaries?: Readonly<{
    readonly appendix_start_block_id?: string | null;
    readonly backmatter_start_block_id?: string | null;
    readonly body_start_block_id?: string;
  }>;
  readonly changes: readonly DraftStructureChange[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly numbering?: HeadingNumberingMode;
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
  readonly alias?: string | null;
  readonly boundaries?: DraftPatch["boundaries"];
  readonly changes: readonly DraftStructureChange[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly numbering?: DraftPatch["numbering"];
} {
  const patch = record(value);
  exactKeys(patch, ["alias", "boundaries", "changes", "metadata", "numbering"]);
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
      "alias",
      "block_id",
      "display_level",
      "include_in_toc",
      "source_number",
      "starts_page",
      "title_markdown",
    ]);
    if (
      typeof change.block_id !== "string" ||
      (change.display_level !== undefined &&
        (!Number.isSafeInteger(change.display_level) ||
          Number(change.display_level) < 1 ||
          Number(change.display_level) > 4)) ||
      (change.title_markdown !== undefined &&
        (typeof change.title_markdown !== "string" ||
          change.title_markdown.length < 1 ||
          change.title_markdown.length > 2_000)) ||
      (change.include_in_toc !== undefined &&
        typeof change.include_in_toc !== "boolean") ||
      (change.starts_page !== undefined &&
        typeof change.starts_page !== "boolean") ||
      (change.source_number !== undefined &&
        change.source_number !== null &&
        typeof change.source_number !== "string") ||
      (change.alias !== undefined &&
        change.alias !== null &&
        typeof change.alias !== "string")
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
  let metadata: Readonly<Record<string, unknown>> | undefined;
  if (patch.metadata !== undefined) {
    metadata = record(patch.metadata);
    exactKeys(metadata, [
      "authors",
      "contributors",
      "cover_path",
      "description",
      "edition",
      "isbn_10",
      "isbn_13",
      "language",
      "publisher",
      "subtitle",
      "title",
      "year",
    ]);
  }
  let boundaries: DraftPatch["boundaries"];
  if (patch.boundaries !== undefined) {
    const value = record(patch.boundaries);
    exactKeys(value, [
      "appendix_start_block_id",
      "backmatter_start_block_id",
      "body_start_block_id",
    ]);
    if (
      (value.body_start_block_id !== undefined &&
        typeof value.body_start_block_id !== "string") ||
      ["appendix_start_block_id", "backmatter_start_block_id"].some(
        (key) =>
          value[key] !== undefined &&
          value[key] !== null &&
          typeof value[key] !== "string",
      )
    ) {
      throw new SafeApplicationError(
        "DRAFT_PATCH_INVALID",
        "The content boundaries are invalid.",
        400,
      );
    }
    boundaries = value as DraftPatch["boundaries"];
  }
  if (
    patch.alias !== undefined &&
    patch.alias !== null &&
    typeof patch.alias !== "string"
  ) {
    throw new SafeApplicationError(
      "DRAFT_PATCH_INVALID",
      "The book alias is invalid.",
      400,
    );
  }
  if (
    patch.numbering !== undefined &&
    patch.numbering !== "generated" &&
    patch.numbering !== "none" &&
    patch.numbering !== "source"
  ) {
    throw new SafeApplicationError(
      "DRAFT_PATCH_INVALID",
      "The heading numbering mode is invalid.",
      400,
    );
  }
  return {
    ...(patch.alias !== undefined
      ? { alias: patch.alias as string | null }
      : {}),
    ...(boundaries ? { boundaries } : {}),
    changes,
    ...(metadata ? { metadata } : {}),
    ...(patch.numbering !== undefined
      ? { numbering: patch.numbering as DraftPatch["numbering"] }
      : {}),
  };
}

function applyNullableFields(
  current: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) Reflect.deleteProperty(result, key);
    else result[key] = value;
  }
  return result;
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
  const currentMetadata = config.metadata as Readonly<Record<string, unknown>>;
  const currentPublishing = config.publishing as Readonly<
    Record<string, unknown>
  >;
  const currentNumbering = currentPublishing.numbering as Readonly<
    Record<string, unknown>
  >;
  const currentBoundaries = config.boundaries as Readonly<
    Record<string, unknown>
  >;
  const configWithAlias: Record<string, unknown> = { ...config };
  if (parsed.alias === null) Reflect.deleteProperty(configWithAlias, "alias");
  else if (parsed.alias !== undefined) configWithAlias.alias = parsed.alias;
  const next = {
    ...configWithAlias,
    boundaries: parsed.boundaries
      ? applyNullableFields(currentBoundaries, parsed.boundaries)
      : currentBoundaries,
    metadata: parsed.metadata
      ? applyNullableFields(currentMetadata, parsed.metadata)
      : currentMetadata,
    publishing:
      parsed.numbering === undefined
        ? currentPublishing
        : {
            ...currentPublishing,
            numbering: { ...currentNumbering, mode: parsed.numbering },
          },
    revision: Number(config.revision) + 1,
    structure: currentNodes.map((node) => {
      const change = changes.get(String(node.block_id));
      if (!change) return node;
      const updated: Record<string, unknown> = { ...node };
      for (const key of [
        "display_level",
        "include_in_toc",
        "starts_page",
        "title_markdown",
      ] as const) {
        if (change[key] !== undefined) updated[key] = change[key];
      }
      for (const key of ["alias", "source_number"] as const) {
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
  validateConfiguredStructureHierarchy(next);
  new SourceRepository(input.database).requireSnapshot(book.draftSourceId);
  const yaml = stringify(next, { lineWidth: 0 });
  if (Buffer.byteLength(yaml, "utf8") > maximumConfigBytes) {
    throw new SafeApplicationError(
      "BOOK_CONFIG_TOO_LARGE",
      "The book configuration is too large.",
      400,
    );
  }
  const yamlSha256 = createHash("sha256").update(yaml).digest("hex");
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
    });
    const selected = new DraftCandidateRepository(
      input.database,
    ).replaceConfigAndCreate({
      bookId: input.bookId,
      expectedRevision: current.revision,
      expectedYamlSha256: current.yamlSha256,
      nowMs: input.nowMs,
      revision: Number(next.revision),
      schemaVersion: Number(next.schema_version),
      sourceId: book.draftSourceId,
      title: String((next.metadata as Readonly<Record<string, unknown>>).title),
      yamlRelativePath: dataRelativePath(input.layout.root, yamlPath),
      yamlSha256,
    });
    return Object.freeze({
      candidate: Object.freeze({
        attemptId: selected.attemptId,
        jobId: selected.jobId,
        state: "building" as const,
      }),
      config: next,
      etag: createStrongEtag(yamlSha256),
      revision: selected.configRevision,
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
