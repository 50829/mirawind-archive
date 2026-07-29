import { createHash } from "node:crypto";

import { validateBookConfig } from "@/schemas/book-config";
import {
  compilerIdentity,
  semanticCompilationDigest,
} from "@/compiler/document/manifest";
import { normalizeDocumentBlocks } from "@/compiler/document/normalize";
import {
  numberConfiguredHeadings,
  type NumberedHeading,
} from "@/compiler/document/numbering";
import { parseMarkdownDocument } from "@/compiler/document/parser";
import {
  splitDocumentPages,
  type CompiledDocumentPage,
} from "@/compiler/document/pages";
import { applySourceRegions } from "@/compiler/document/source-regions";
import type {
  ConfirmedSourceRegion,
  NormalizedDocument,
  SemanticCompilationIdentity,
} from "@/compiler/document/types";
import {
  validateDocumentConfig,
  type ValidatedDocumentConfig,
} from "@/compiler/document/validate-config";

interface ConfigStructureNode {
  readonly block_id: string;
}

export interface ConfiguredDocument {
  readonly document: NormalizedDocument;
  readonly excludedBlockIds: ReadonlySet<string>;
  readonly fullDocument: NormalizedDocument;
  readonly headings: readonly NumberedHeading[];
  readonly identity: SemanticCompilationIdentity;
  readonly pages: readonly CompiledDocumentPage[];
  readonly sourceRegions: readonly ConfirmedSourceRegion[];
  readonly validated: ValidatedDocumentConfig;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function configuredBlockId(configSha256: string, ordinal: number): string {
  return `blk_${createHash("sha256")
    .update("mirawind-configured-block-v1\0")
    .update(configSha256)
    .update("\0")
    .update(String(ordinal))
    .digest("base64url")
    .slice(0, 24)}`;
}

function configuredStructure(
  config: Readonly<Record<string, unknown>>,
): readonly ConfigStructureNode[] {
  return config.structure as readonly ConfigStructureNode[];
}

function configuredRegions(
  config: Readonly<Record<string, unknown>>,
): readonly ConfirmedSourceRegion[] {
  return (config.source_regions as readonly ConfirmedSourceRegion[]).filter(
    (region) => region.applied,
  );
}

function semanticPayload(input: {
  readonly configSha256: string;
  readonly document: NormalizedDocument;
  readonly headings: readonly NumberedHeading[];
  readonly pages: readonly CompiledDocumentPage[];
  readonly sourceSha256: string;
}): Readonly<Record<string, unknown>> {
  return Object.freeze({
    blocks: input.document.blocks.map((block) => ({
      block_id: block.blockId,
      kind: block.type,
      source_end: block.position?.end.offset,
      source_start: block.position?.start.offset,
      visible_text: block.visibleText ?? "",
    })),
    compiler: compilerIdentity,
    config_sha256: input.configSha256,
    headings: input.headings.map((heading) => ({
      alias: heading.alias ?? null,
      block_id: heading.block_id,
      display_level: heading.display_level,
      display_title: heading.display_title,
      include_in_toc: heading.include_in_toc,
      number: heading.number,
      role: heading.role,
      starts_page: heading.starts_page,
    })),
    pages: input.pages.map((page) => ({
      alias: page.alias ?? null,
      block_ids: page.blockIds,
      first_block_id: page.firstBlockId,
      page_id: page.pageId,
      title: page.title,
    })),
    source_sha256: input.sourceSha256,
  });
}

/**
 * Builds the single semantic document model consumed by preview and publication.
 * The accepted Markdown is read-only here: preprocessing must already be complete.
 */
export function prepareConfiguredDocument(input: {
  readonly config: unknown;
  readonly configSha256: string;
  readonly markdownBytes: string | Uint8Array;
  readonly sourceHeadingBlockIds?: readonly string[];
}): ConfiguredDocument {
  if (!/^[a-f0-9]{64}$/u.test(input.configSha256)) {
    throw new Error("CONFIGURED_DOCUMENT_CONFIG_HASH_INVALID");
  }
  const config = validateBookConfig(input.config);
  const source = config.source as Readonly<Record<string, unknown>>;
  const sourceSha256 = String(source.main_markdown_sha256);
  const markdown =
    typeof input.markdownBytes === "string"
      ? input.markdownBytes
      : Buffer.from(input.markdownBytes).toString("utf8");
  if (sha256(markdown) !== sourceSha256) {
    throw new Error("CONFIGURED_DOCUMENT_SOURCE_HASH_MISMATCH");
  }

  const structure = configuredStructure(config);
  const sourceHeadingBlockIds =
    input.sourceHeadingBlockIds ?? structure.map((heading) => heading.block_id);
  let headingIndex = 0;
  let blockOrdinal = 0;
  const fullDocument = normalizeDocumentBlocks(
    parseMarkdownDocument(markdown),
    {
      idFactory(node) {
        if (node.type === "heading") {
          const blockId = sourceHeadingBlockIds[headingIndex++];
          if (!blockId) {
            throw new Error("CONFIGURED_DOCUMENT_HEADING_COUNT_MISMATCH");
          }
          return blockId;
        }
        return configuredBlockId(input.configSha256, ++blockOrdinal);
      },
    },
  );
  if (
    headingIndex !== sourceHeadingBlockIds.length ||
    sourceHeadingBlockIds.length !== structure.length
  ) {
    throw new Error("CONFIGURED_DOCUMENT_HEADING_COUNT_MISMATCH");
  }

  const sourceRegions = configuredRegions(config);
  const applied = applySourceRegions({
    document: fullDocument,
    mainMarkdownPath: String(source.main_markdown),
    mainMarkdownSha256: sourceSha256,
    regions: sourceRegions,
  });
  const validated = validateDocumentConfig({
    activeDocument: applied.document,
    config,
    document: fullDocument,
  });
  const publishing = config.publishing as Readonly<Record<string, unknown>>;
  const numbering = publishing.numbering as Readonly<Record<string, unknown>>;
  const headings = numberConfiguredHeadings(
    validated.headings,
    numbering.mode === "preserve" ? "preserve" : "normalized",
  );
  const pages = splitDocumentPages({
    bookTitle: String(config.title),
    document: applied.document,
    headings,
  });
  const identity = Object.freeze({
    compiler_version: compilerIdentity.version,
    config_sha256: input.configSha256,
    renderer_version: compilerIdentity.renderer_version,
    semantic_digest: semanticCompilationDigest(
      semanticPayload({
        configSha256: input.configSha256,
        document: applied.document,
        headings,
        pages,
        sourceSha256,
      }),
    ),
    source_sha256: sourceSha256,
  });

  return Object.freeze({
    document: applied.document,
    excludedBlockIds: applied.excludedBlockIds,
    fullDocument,
    headings,
    identity,
    pages,
    sourceRegions,
    validated,
  });
}
