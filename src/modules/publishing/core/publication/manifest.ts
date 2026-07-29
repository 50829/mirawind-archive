import { createHash } from "node:crypto";

import type {
  ResourceReference,
  ResolvedResource,
} from "@/modules/publishing/core/publication/resource-model";
import type { CompiledBook } from "@/modules/publishing/core/publication/compiled-book";
import {
  pageBlockIds,
  pageMetadata,
  pageOutputPath,
} from "@/modules/publishing/core/publication/compiled-book";
import { validateDocumentManifest } from "@/modules/publishing/core/publication/document-manifest-schema";
import type { TransientDocumentNode } from "@/modules/publishing/core/preparation/document-model";

export const compilerIdentity = Object.freeze({
  name: "mirawind-book-compiler" as const,
  renderer_version: "semantic-html-v4-katex-0.18.1",
  text_normalization_version: 2,
  version: "compiler-v4",
});

export interface ManifestSourceFile {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}

export interface ManifestResource extends ResolvedResource {
  readonly height: number;
  readonly mediaType: string;
  readonly outputPath: string;
  readonly sha256: string;
  readonly size: number;
  readonly width: number;
}

const kindByNodeType: Readonly<Record<string, string>> = {
  blockquote: "blockquote",
  code: "code",
  footnoteDefinition: "footnote",
  heading: "heading",
  image: "image",
  listItem: "list_item",
  math: "math",
  paragraph: "paragraph",
  semanticContainer: "semantic_container",
  table: "table",
};

function fingerprint(text: string): string {
  return createHash("sha256")
    .update("mirawind-visible-text-v1\0")
    .update(text, "utf8")
    .digest("hex");
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) =>
          Buffer.from(left).compare(Buffer.from(right)),
        )
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalValue(value))}\n`;
}

export function semanticCompilationDigest(value: unknown): string {
  return createHash("sha256")
    .update("mirawind-semantic-compilation-v1\0")
    .update(canonicalJson(value))
    .digest("hex");
}

function resourceIdsFor(
  block: TransientDocumentNode,
  references: readonly ResourceReference[],
): readonly string[] {
  if (block.type !== "image") return [];
  const start = block.position?.start.offset;
  const end = block.position?.end.offset;
  return Object.freeze(
    references
      .filter(
        (reference) =>
          start !== undefined &&
          end !== undefined &&
          reference.position?.start.offset === start &&
          reference.position.end.offset === end,
      )
      .map((reference) => reference.resourceId)
      .filter((value, index, values) => values.indexOf(value) === index)
      .sort((left, right) => Buffer.from(left).compare(Buffer.from(right))),
  );
}

export function buildDocumentManifest(input: {
  readonly bookId: number;
  readonly book: CompiledBook;
  readonly configRevision: number;
  readonly createdAt: string;
  readonly mainMarkdownOutputPath: string;
  readonly resourceReferences: readonly ResourceReference[];
  readonly resources: readonly ManifestResource[];
  readonly sourceFiles: readonly ManifestSourceFile[];
  readonly versionId: string;
}): Readonly<Record<string, unknown>> {
  const blocks = Object.fromEntries(
    input.book.document.blocks.map((block) => {
      if (!block.blockId || !block.position) {
        throw new Error("MANIFEST_BLOCK_ID_OR_POSITION_MISSING");
      }
      const kind = kindByNodeType[block.type];
      const pageId = input.book.pageByBlockId.get(block.blockId)?.pageId;
      if (!kind || !pageId) throw new Error("MANIFEST_BLOCK_UNSUPPORTED");
      return [
        block.blockId,
        {
          kind,
          normalized_visible_text: block.visibleText ?? "",
          page_id: pageId,
          resource_ids: resourceIdsFor(block, input.resourceReferences),
          source: {
            end: {
              column: block.position.end.column,
              line: block.position.end.line,
            },
            path: input.mainMarkdownOutputPath,
            start: {
              column: block.position.start.column,
              line: block.position.start.line,
            },
          },
          text_fingerprint: {
            algorithm: "sha256",
            normalization_version: compilerIdentity.text_normalization_version,
            value: fingerprint(block.visibleText ?? ""),
          },
        },
      ];
    }),
  );
  const manifest = {
    blocks,
    book_id: input.bookId,
    compiler: compilerIdentity,
    config_revision: input.configRevision,
    created_at: input.createdAt,
    pages: input.book.pages.map((page) => {
      const metadata = pageMetadata(input.book, page);
      return {
        ...(metadata.alias ? { alias: metadata.alias } : {}),
        block_ids: pageBlockIds(input.book, page),
        first_block_id: page.firstBlockId,
        output_path: pageOutputPath(page),
        page_id: page.pageId,
        title: metadata.title,
      };
    }),
    resources: Object.fromEntries(
      [...input.resources]
        .sort((left, right) =>
          Buffer.from(left.id).compare(Buffer.from(right.id)),
        )
        .map((resource) => [
          resource.id,
          {
            height: resource.height,
            media_type: resource.mediaType,
            output_path: resource.outputPath,
            sha256: resource.sha256,
            size: resource.size,
            source_path: `source/${resource.relativePath}`,
            width: resource.width,
          },
        ]),
    ),
    schema_version: 2,
    source_files: [...input.sourceFiles].sort((left, right) =>
      Buffer.from(left.path).compare(Buffer.from(right.path)),
    ),
    toc: input.book.headings
      .filter((heading) => heading.include_in_toc)
      .map((heading) => {
        const pageId = input.book.pageByHeadingId.get(heading.block_id)?.pageId;
        const block = blocks[heading.block_id];
        if (
          !pageId ||
          !block ||
          !input.book.headingByBlockId.has(heading.block_id)
        ) {
          throw new Error("MANIFEST_TOC_REFERENCE_MISSING");
        }
        return {
          block_id: heading.block_id,
          level: heading.display_level,
          number: heading.number,
          page_id: pageId,
          role: heading.role,
          title: heading.display_title,
        };
      }),
    version_id: input.versionId,
  };
  return validateDocumentManifest(manifest);
}
