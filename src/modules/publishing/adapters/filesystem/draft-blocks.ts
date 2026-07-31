import type Database from "better-sqlite3";

import { SafeApplicationError } from "@/domain/errors";
import { createStrongEtag } from "@/http/cache/policies";
import {
  draftSourceConfig,
  draftSourceSha256,
  maximumDraftSourceBytes,
  readCurrentDraftBlock,
} from "@/modules/publishing/adapters/filesystem/draft-block-source";
import { createDraftSourceRevision } from "@/modules/publishing/adapters/filesystem/draft-source-revision";
import { editDocumentBlock } from "@/modules/publishing/core/preparation/edit-document-block";
import { validateBookConfig } from "@/modules/publishing/core/publication/book-config-schema";
import { validateConfiguredStructureHierarchy } from "@/modules/publishing/core/publication/validate-config";
import type { StorageLayout } from "@/platform/filesystem/layout";

const maximumBlockMarkdownBytes = 4 * 1024 * 1024;

export interface DraftBlockProjection {
  readonly block_id: string;
  readonly config_revision: number;
  readonly etag: string;
  readonly kind: string;
  readonly markdown: string;
}

export interface DraftBlockUpdate {
  readonly candidate: {
    readonly attemptId: string;
    readonly jobId: string;
    readonly state: "building";
  };
  readonly etag: string;
  readonly revision: number;
  readonly selectedBlockId: string | null;
}

export async function getDraftBlock(input: {
  readonly blockId: string;
  readonly bookId: number;
  readonly database: Database.Database;
  readonly layout: StorageLayout;
}): Promise<DraftBlockProjection> {
  const current = await readCurrentDraftBlock(input);
  return Object.freeze({
    block_id: current.block.block_id,
    config_revision: current.configRecord.revision,
    etag: createStrongEtag(current.configRecord.yamlSha256),
    kind: current.block.kind,
    markdown: current.markdown.slice(
      current.block.start_offset,
      current.block.end_offset,
    ),
  });
}

function parsePatch(value: unknown): string {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !("markdown" in value) ||
    typeof value.markdown !== "string" ||
    Buffer.byteLength(value.markdown, "utf8") > maximumBlockMarkdownBytes ||
    value.markdown.includes("\0")
  ) {
    throw new SafeApplicationError(
      "DRAFT_BLOCK_PATCH_INVALID",
      "The draft block patch is invalid.",
      400,
    );
  }
  return value.markdown;
}

function sourceEditFailure(error: unknown): never {
  if (
    error instanceof Error &&
    [
      "SOURCE_BLOCK_NOT_EDITABLE",
      "SOURCE_BLOCK_RANGE_INVALID",
      "SOURCE_DOCUMENT_EMPTY",
      "SOURCE_EDIT_HEADING_CHANGE_FORBIDDEN",
    ].includes(error.message)
  ) {
    throw new SafeApplicationError(
      error.message,
      error.message === "SOURCE_EDIT_HEADING_CHANGE_FORBIDDEN"
        ? "Edit headings in the structure editor."
        : "The replacement Markdown is not a valid editable block.",
      400,
    );
  }
  throw error;
}

export async function patchDraftBlock(input: {
  readonly blockId: string;
  readonly bookId: number;
  readonly database: Database.Database;
  readonly expectedEtag: string | null;
  readonly layout: StorageLayout;
  readonly nowMs: number;
  readonly patch: unknown;
}): Promise<DraftBlockUpdate> {
  const replacement = parsePatch(input.patch);
  const current = await readCurrentDraftBlock(input);
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
  const sourceValue = draftSourceConfig(current.config);
  let edited: ReturnType<typeof editDocumentBlock>;
  try {
    edited = editDocumentBlock({
      blockId: input.blockId,
      blocks: sourceValue.blocks as Parameters<
        typeof editDocumentBlock
      >[0]["blocks"],
      markdown: current.markdown,
      replacement,
    });
  } catch (error) {
    sourceEditFailure(error);
  }
  if (Buffer.byteLength(edited.markdown, "utf8") > maximumDraftSourceBytes) {
    throw new SafeApplicationError(
      "DRAFT_SOURCE_TOO_LARGE",
      "The edited draft source is too large.",
      413,
    );
  }

  const nextSourceSha256 = draftSourceSha256(edited.markdown);
  const preprocessing = sourceValue.preprocessing as Readonly<
    Record<string, unknown>
  >;
  const revision = current.configRecord.revision + 1;
  const nextConfig = validateBookConfig({
    ...current.config,
    revision,
    source: {
      ...sourceValue,
      blocks: edited.blocks,
      main_markdown_sha256: nextSourceSha256,
      preprocessing: {
        ...preprocessing,
        source_edit: {
          block_id: input.blockId,
          input_sha256: current.source.mainMarkdownSha256,
          output_sha256: nextSourceSha256,
        },
      },
    },
  });
  validateConfiguredStructureHierarchy(nextConfig);

  const update = await createDraftSourceRevision({
    bookId: input.bookId,
    current,
    database: input.database,
    layout: input.layout,
    markdown: edited.markdown,
    nextConfig,
    nowMs: input.nowMs,
  });
  return Object.freeze({
    ...update,
    selectedBlockId: edited.selectedBlockId,
  });
}
