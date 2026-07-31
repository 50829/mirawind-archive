import type { NormalizedDocument } from "@/modules/publishing/core/preparation/document-model";
import { configuredHeadingTitle } from "@/modules/publishing/core/preparation/heading-title";
import { createSourceBlockRecords } from "@/modules/publishing/core/preparation/source-block-records";

export interface TestStructureNode {
  readonly alias?: string;
  readonly block_id: string;
  readonly display_level: number;
  readonly include_in_toc: boolean;
  readonly source_number?: string;
  readonly starts_page: boolean;
  readonly title_markdown: string;
}

export function structureForDocument(
  document: NormalizedDocument,
): readonly TestStructureNode[] {
  return document.headings.map((heading) => {
    const title = configuredHeadingTitle({ document, heading });
    return Object.freeze({
      block_id: heading.blockId,
      display_level: heading.level,
      include_in_toc: true,
      ...(title.number ? { source_number: title.number } : {}),
      starts_page: heading.level === 1,
      title_markdown: title.markdown,
    });
  });
}

export function createBookConfigV4(input: {
  readonly alias?: string;
  readonly bookId?: number;
  readonly boundaries?: Readonly<{
    readonly appendix_start_block_id?: string;
    readonly backmatter_start_block_id?: string;
    readonly body_start_block_id: string;
  }>;
  readonly document: NormalizedDocument;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly numbering?: "generated" | "none" | "source";
  readonly preCleanupSha256?: string;
  readonly revision?: number;
  readonly sourcePath?: string;
  readonly sourceSha256: string;
  readonly originalFiles?: readonly Readonly<Record<string, unknown>>[];
  readonly structure?: readonly TestStructureNode[];
  readonly title: string;
}): Readonly<Record<string, unknown>> {
  const structure = input.structure ?? structureForDocument(input.document);
  const first = structure[0];
  if (!first) throw new Error("TEST_BOOK_STRUCTURE_EMPTY");
  const preCleanupSha256 = input.preCleanupSha256 ?? input.sourceSha256;
  return Object.freeze({
    ...(input.alias ? { alias: input.alias } : {}),
    book_id: input.bookId ?? 1,
    boundaries: input.boundaries ?? {
      body_start_block_id: first.block_id,
    },
    metadata: { ...input.metadata, title: input.title },
    publishing: {
      code: { line_numbers: false },
      numbering: { mode: input.numbering ?? "source" },
    },
    revision: input.revision ?? 1,
    schema_version: 4,
    source: {
      blocks: createSourceBlockRecords(input.document),
      main_markdown: input.sourcePath ?? "book.md",
      main_markdown_sha256: input.sourceSha256,
      original_files: input.originalFiles ?? [],
      preprocessing: {
        content_cleanup: {
          helper_blocks_removed: 0,
          input_sha256: preCleanupSha256,
          output_sha256: input.sourceSha256,
          printed_toc_regions_removed: 0,
        },
        typography: {
          input_sha256: preCleanupSha256,
          output_sha256: preCleanupSha256,
          profile: "verbatim-v1",
          protected_nodes: 0,
          punctuation_converted: 0,
          spaces_normalized: 0,
        },
      },
    },
    structure,
  });
}
