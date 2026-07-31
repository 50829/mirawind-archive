import { SafeApplicationError } from "@/domain/errors";
import type { NormalizedDocument } from "@/modules/publishing/core/preparation/document-model";
import type { ContentRole } from "@/modules/publishing/core/preparation/structure-proposal";
import { validateBookConfig } from "@/modules/publishing/core/publication/book-config-schema";

export interface ConfigSemanticDiagnostic {
  readonly block_id?: string;
  readonly code:
    | "BLOCK_IDENTITY_MISMATCH"
    | "DISPLAY_LEVEL_SKIPPED"
    | "HEADING_ORDER_CHANGED"
    | "HEADING_REQUIRED"
    | "HEADING_SET_MISMATCH"
    | "HEADING_UNKNOWN";
  readonly field?: string;
}

export class ConfigSemanticValidationError extends SafeApplicationError {
  readonly diagnostics: readonly ConfigSemanticDiagnostic[];

  constructor(diagnostics: readonly ConfigSemanticDiagnostic[]) {
    super(
      "BOOK_CONFIG_SEMANTIC_INVALID",
      "The book configuration does not match the source document.",
      400,
    );
    this.name = "ConfigSemanticValidationError";
    this.diagnostics = Object.freeze(diagnostics.slice(0, 100));
  }
}

interface StructureNode {
  readonly alias?: string;
  readonly block_id: string;
  readonly display_level: number;
  readonly include_in_toc: boolean;
  readonly source_number?: string;
  readonly starts_page: boolean;
  readonly title_markdown: string;
}

interface SourceBlockRecord {
  readonly block_id: string;
  readonly end_offset: number;
  readonly kind: string;
  readonly start_offset: number;
  readonly text_fingerprint: string;
}

interface Boundaries {
  readonly appendix_start_block_id?: string;
  readonly backmatter_start_block_id?: string;
  readonly body_start_block_id: string;
}

export interface ValidatedConfiguredHeading extends StructureNode {
  readonly role: ContentRole;
  readonly source_level: number;
  readonly source_title: string;
}

export interface ValidatedDocumentConfig {
  readonly config: Readonly<Record<string, unknown>>;
  readonly headings: readonly ValidatedConfiguredHeading[];
}

function structureOf(
  config: Readonly<Record<string, unknown>>,
): readonly StructureNode[] {
  return config.structure as readonly StructureNode[];
}

function sourceBlocksOf(
  config: Readonly<Record<string, unknown>>,
): readonly SourceBlockRecord[] {
  return (config.source as { readonly blocks: readonly SourceBlockRecord[] })
    .blocks;
}

function boundariesOf(config: Readonly<Record<string, unknown>>): Boundaries {
  return config.boundaries as unknown as Boundaries;
}

function diagnostic(
  code: ConfigSemanticDiagnostic["code"],
  blockId?: string,
  field?: string,
): ConfigSemanticDiagnostic {
  return Object.freeze({
    ...(blockId ? { block_id: blockId } : {}),
    code,
    ...(field ? { field } : {}),
  });
}

function hierarchyDiagnostics(
  structure: readonly StructureNode[],
): readonly ConfigSemanticDiagnostic[] {
  const diagnostics: ConfigSemanticDiagnostic[] = [];
  let previousLevel = 0;
  for (let index = 0; index < structure.length; index += 1) {
    const configured = structure[index];
    if (!configured) continue;
    if (
      (index === 0 && configured.display_level !== 1) ||
      (index > 0 && configured.display_level > previousLevel + 1)
    ) {
      diagnostics.push(
        diagnostic(
          "DISPLAY_LEVEL_SKIPPED",
          configured.block_id,
          `structure/${index}/display_level`,
        ),
      );
    }
    previousLevel = configured.display_level;
  }
  return Object.freeze(diagnostics);
}

export function validateConfiguredStructureHierarchy(
  config: Readonly<Record<string, unknown>>,
): void {
  const diagnostics = hierarchyDiagnostics(structureOf(config));
  if (diagnostics.length > 0) {
    throw new ConfigSemanticValidationError(diagnostics);
  }
}

interface BoundaryIndexes {
  readonly appendix?: number;
  readonly backmatter?: number;
  readonly body: number;
}

function boundaryIndexes(
  structure: readonly StructureNode[],
  boundaries: Boundaries,
): BoundaryIndexes {
  const indexById = new Map(
    structure.map((node, nodeIndex) => [node.block_id, nodeIndex] as const),
  );
  const appendix = boundaries.appendix_start_block_id
    ? indexById.get(boundaries.appendix_start_block_id)
    : undefined;
  const backmatter = boundaries.backmatter_start_block_id
    ? indexById.get(boundaries.backmatter_start_block_id)
    : undefined;
  return Object.freeze({
    ...(appendix === undefined ? {} : { appendix }),
    ...(backmatter === undefined ? {} : { backmatter }),
    body: indexById.get(boundaries.body_start_block_id) ?? 0,
  });
}

function roleAt(index: number, boundaries: BoundaryIndexes): ContentRole {
  if (boundaries.backmatter !== undefined && index >= boundaries.backmatter) {
    return "backmatter";
  }
  if (boundaries.appendix !== undefined && index >= boundaries.appendix) {
    return "appendix";
  }
  return index < boundaries.body ? "frontmatter" : "body";
}

function validateBlockIdentities(
  configured: readonly SourceBlockRecord[],
  document: NormalizedDocument,
): readonly ConfigSemanticDiagnostic[] {
  if (configured.length !== document.blocks.length) {
    return Object.freeze([
      diagnostic("BLOCK_IDENTITY_MISMATCH", undefined, "source/blocks"),
    ]);
  }
  const diagnostics: ConfigSemanticDiagnostic[] = [];
  for (const [index, block] of document.blocks.entries()) {
    const expected = configured[index];
    if (
      !expected ||
      block.blockId !== expected.block_id ||
      block.type !== expected.kind ||
      block.position?.start.offset !== expected.start_offset ||
      block.position.end.offset !== expected.end_offset ||
      block.textFingerprint !== expected.text_fingerprint
    ) {
      diagnostics.push(
        diagnostic(
          "BLOCK_IDENTITY_MISMATCH",
          expected?.block_id,
          `source/blocks/${index}`,
        ),
      );
      if (diagnostics.length >= 100) break;
    }
  }
  return Object.freeze(diagnostics);
}

export function validateDocumentConfig(input: {
  readonly config: unknown;
  readonly document: NormalizedDocument;
}): ValidatedDocumentConfig {
  const config = validateBookConfig(input.config);
  const structure = structureOf(config);
  const diagnostics: ConfigSemanticDiagnostic[] = [
    ...hierarchyDiagnostics(structure),
    ...validateBlockIdentities(sourceBlocksOf(config), input.document),
  ];
  if (structure.length !== input.document.headings.length) {
    diagnostics.push(
      diagnostic("HEADING_SET_MISMATCH", undefined, "structure"),
    );
  }
  const headingIds = new Set(
    input.document.headings.map((heading) => heading.blockId),
  );
  const blockIds = new Set(
    input.document.blocks.flatMap((block) =>
      block.blockId ? [block.blockId] : [],
    ),
  );
  const boundaries = boundariesOf(config);
  const configuredBoundaryIndexes = boundaryIndexes(structure, boundaries);
  const headings: ValidatedConfiguredHeading[] = [];
  for (let index = 0; index < structure.length; index += 1) {
    const configured = structure[index];
    const source = input.document.headings[index];
    if (!configured) continue;
    if (!source || configured.block_id !== source.blockId) {
      const code = headingIds.has(configured.block_id)
        ? "HEADING_ORDER_CHANGED"
        : blockIds.has(configured.block_id)
          ? "HEADING_REQUIRED"
          : "HEADING_UNKNOWN";
      diagnostics.push(
        diagnostic(code, configured.block_id, `structure/${index}/block_id`),
      );
      continue;
    }
    headings.push(
      Object.freeze({
        ...configured,
        role: roleAt(index, configuredBoundaryIndexes),
        source_level: source.level,
        source_title: source.sourceTitle,
      }),
    );
  }
  if (diagnostics.length > 0) {
    throw new ConfigSemanticValidationError(diagnostics);
  }
  return Object.freeze({ config, headings: Object.freeze(headings) });
}
