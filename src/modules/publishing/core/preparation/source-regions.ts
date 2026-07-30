import { createHash } from "node:crypto";

import { SafeApplicationError } from "@/domain/errors";
import type {
  ConfirmedSourceRegion,
  NormalizedDocument,
  TransientDocumentNode,
  Utf8ByteRange,
} from "@/modules/publishing/core/preparation/document-model";
import { SourceTextIndex } from "@/modules/publishing/core/preparation/source-text-index";

export interface SourceRegionDiagnostic {
  readonly code:
    | "SOURCE_REGION_AST_BOUNDARY"
    | "SOURCE_REGION_DIGEST_MISMATCH"
    | "SOURCE_REGION_ENTRY_INVALID"
    | "SOURCE_REGION_OVERLAP"
    | "SOURCE_REGION_RANGE_INVALID"
    | "SOURCE_REGION_REFERENCE_CONFLICT"
    | "SOURCE_REGION_SOURCE_MISMATCH";
  readonly path: string;
}

export class SourceRegionValidationError extends SafeApplicationError {
  readonly diagnostics: readonly SourceRegionDiagnostic[];

  constructor(
    code: "SOURCE_REGION_INVALID" | "SOURCE_REGION_REFERENCE_CONFLICT",
    diagnostics: readonly SourceRegionDiagnostic[],
  ) {
    super(
      code,
      code === "SOURCE_REGION_REFERENCE_CONFLICT"
        ? "A reference-only region removes content referenced by the active document."
        : "A configured source region does not match the accepted Markdown.",
      400,
    );
    this.name = "SourceRegionValidationError";
    this.diagnostics = Object.freeze(diagnostics.slice(0, 100));
  }
}

export interface AppliedSourceRegions {
  readonly document: NormalizedDocument;
  readonly excludedBlockIds: ReadonlySet<string>;
  readonly excludedRootIndexes: ReadonlySet<number>;
}

function diagnostic(
  code: SourceRegionDiagnostic["code"],
  path: string,
): SourceRegionDiagnostic {
  return Object.freeze({ code, path: path.slice(0, 500) });
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function byteRangeForNode(
  sourceIndex: SourceTextIndex,
  node: TransientDocumentNode,
): { readonly end: number; readonly start: number } | undefined {
  if (!node.position) return undefined;
  return Object.freeze({
    end: sourceIndex.byteOffsetAt(node.position.end.offset),
    start: sourceIndex.byteOffsetAt(node.position.start.offset),
  });
}

function validateRangeDigest(
  bytes: Uint8Array,
  range: Utf8ByteRange,
  path: string,
  diagnostics: SourceRegionDiagnostic[],
): void {
  if (
    !Number.isInteger(range.start_byte) ||
    !Number.isInteger(range.end_byte) ||
    range.start_byte < 0 ||
    range.start_byte >= range.end_byte ||
    range.end_byte > bytes.byteLength
  ) {
    diagnostics.push(diagnostic("SOURCE_REGION_RANGE_INVALID", path));
    return;
  }
  if (hash(bytes.subarray(range.start_byte, range.end_byte)) !== range.sha256) {
    diagnostics.push(diagnostic("SOURCE_REGION_DIGEST_MISMATCH", path));
  }
}

function visit(
  node: TransientDocumentNode,
  callback: (node: TransientDocumentNode) => void,
): void {
  callback(node);
  for (const child of node.children ?? []) visit(child, callback);
}

function referencedIdentifiers(
  nodes: readonly TransientDocumentNode[],
): ReadonlySet<string> {
  const identifiers = new Set<string>();
  for (const root of nodes) {
    visit(root, (node) => {
      if (
        (node.type === "footnoteReference" ||
          node.type === "imageReference" ||
          node.type === "linkReference") &&
        node.identifier
      ) {
        identifiers.add(node.identifier.toLowerCase());
      }
    });
  }
  return identifiers;
}

function definedIdentifiers(
  nodes: readonly TransientDocumentNode[],
): ReadonlySet<string> {
  const identifiers = new Set<string>();
  for (const root of nodes) {
    visit(root, (node) => {
      if (
        (node.type === "definition" || node.type === "footnoteDefinition") &&
        node.identifier
      ) {
        identifiers.add(node.identifier.toLowerCase());
      }
    });
  }
  return identifiers;
}

export function applySourceRegions(input: {
  readonly document: NormalizedDocument;
  readonly mainMarkdownPath: string;
  readonly mainMarkdownSha256: string;
  readonly regions: readonly ConfirmedSourceRegion[];
}): AppliedSourceRegions {
  const diagnostics: SourceRegionDiagnostic[] = [];
  const sourceBytes = Buffer.from(input.document.source, "utf8");
  const sourceIndex = new SourceTextIndex(input.document.source);
  if (hash(sourceBytes) !== input.mainMarkdownSha256) {
    diagnostics.push(
      diagnostic(
        "SOURCE_REGION_SOURCE_MISMATCH",
        "source/main_markdown_sha256",
      ),
    );
  }
  const children = input.document.root.children ?? [];
  const rootRanges = children.map((child) =>
    byteRangeForNode(sourceIndex, child),
  );
  const rootIndexByStartByte = new Map<number, number>();
  const rootIndexByEndByte = new Map<number, number>();
  for (const [rootIndex, range] of rootRanges.entries()) {
    if (!range) continue;
    rootIndexByStartByte.set(range.start, rootIndex);
    rootIndexByEndByte.set(range.end, rootIndex);
  }
  const excludedRootIndexes = new Set<number>();
  const excludedCharacterIntervals: {
    readonly end: number;
    readonly start: number;
  }[] = [];
  let previousEnd = -1;
  for (const [regionIndex, region] of input.regions.entries()) {
    const regionPath = `source_regions/${regionIndex}`;
    if (
      region.source_path !== input.mainMarkdownPath ||
      region.source_sha256 !== input.mainMarkdownSha256
    ) {
      diagnostics.push(diagnostic("SOURCE_REGION_SOURCE_MISMATCH", regionPath));
    }
    validateRangeDigest(
      sourceBytes,
      region.range,
      `${regionPath}/range`,
      diagnostics,
    );
    if (region.range.start_byte < previousEnd) {
      diagnostics.push(diagnostic("SOURCE_REGION_OVERLAP", regionPath));
    }
    previousEnd = region.range.end_byte;

    const startIndex = rootIndexByStartByte.get(region.range.start_byte);
    const endIndex = rootIndexByEndByte.get(region.range.end_byte);
    if (
      startIndex === undefined ||
      endIndex === undefined ||
      endIndex < startIndex
    ) {
      diagnostics.push(
        diagnostic("SOURCE_REGION_AST_BOUNDARY", `${regionPath}/range`),
      );
    } else {
      for (let index = startIndex; index <= endIndex; index += 1) {
        if (excludedRootIndexes.has(index)) {
          diagnostics.push(diagnostic("SOURCE_REGION_OVERLAP", regionPath));
        }
        excludedRootIndexes.add(index);
      }
      const startOffset = children[startIndex]?.position?.start.offset;
      const endOffset = children[endIndex]?.position?.end.offset;
      if (startOffset !== undefined && endOffset !== undefined) {
        excludedCharacterIntervals.push(
          Object.freeze({ end: endOffset, start: startOffset }),
        );
      }
    }

    let previousEntryEnd = region.range.start_byte;
    for (const [entryIndex, entry] of region.entries.entries()) {
      const entryPath = `${regionPath}/entries/${entryIndex}/range`;
      validateRangeDigest(sourceBytes, entry.range, entryPath, diagnostics);
      if (
        entry.range.start_byte < previousEntryEnd ||
        entry.range.start_byte < region.range.start_byte ||
        entry.range.end_byte > region.range.end_byte
      ) {
        diagnostics.push(diagnostic("SOURCE_REGION_ENTRY_INVALID", entryPath));
      }
      previousEntryEnd = entry.range.end_byte;
    }
  }
  if (diagnostics.length > 0) {
    throw new SourceRegionValidationError("SOURCE_REGION_INVALID", diagnostics);
  }

  const excludedRoots: TransientDocumentNode[] = [];
  const activeRoots: TransientDocumentNode[] = [];
  for (const [rootIndex, root] of children.entries()) {
    (excludedRootIndexes.has(rootIndex) ? excludedRoots : activeRoots).push(
      root,
    );
  }
  const referenced = referencedIdentifiers(activeRoots);
  const defined = definedIdentifiers(excludedRoots);
  if ([...referenced].some((identifier) => defined.has(identifier))) {
    throw new SourceRegionValidationError("SOURCE_REGION_REFERENCE_CONFLICT", [
      diagnostic(
        "SOURCE_REGION_REFERENCE_CONFLICT",
        "source_regions/reference_integrity",
      ),
    ]);
  }

  const excludedBlockIds = new Set<string>();
  let intervalIndex = 0;
  for (const block of input.document.blocks) {
    const start = block.position?.start.offset;
    const end = block.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    let interval = excludedCharacterIntervals[intervalIndex];
    while (interval && start >= interval.end) {
      intervalIndex += 1;
      interval = excludedCharacterIntervals[intervalIndex];
    }
    if (
      interval &&
      start >= interval.start &&
      end <= interval.end &&
      block.blockId
    ) {
      excludedBlockIds.add(block.blockId);
    }
  }
  const activeBlocks = input.document.blocks.filter(
    (block) => !block.blockId || !excludedBlockIds.has(block.blockId),
  );
  const activeHeadings = input.document.headings.filter(
    (heading) => !excludedBlockIds.has(heading.blockId),
  );
  return Object.freeze({
    document: Object.freeze({
      blocks: Object.freeze(activeBlocks),
      headings: Object.freeze(activeHeadings),
      root: Object.freeze({
        ...input.document.root,
        children: Object.freeze(activeRoots),
      }),
      source: input.document.source,
    }),
    excludedBlockIds: excludedBlockIds as ReadonlySet<string>,
    excludedRootIndexes: excludedRootIndexes as ReadonlySet<number>,
  });
}
