import { createHash } from "node:crypto";

import type {
  ConfirmedSourceRegion,
  NormalizedDocument,
  TransientDocumentNode,
} from "./document-model";
import { normalizeDocumentBlocks } from "./normalize-document";
import { parseMarkdownDocument } from "./parse-markdown";
import { applySourceRegions } from "./source-regions";
import { SourceTextIndex } from "./source-text-index";

export interface PreparedDocument {
  readonly active: NormalizedDocument;
  readonly activeMarkdown: string;
  readonly cleanup: ContentCleanupProvenance;
  readonly full: NormalizedDocument;
  readonly removedRegions: readonly ConfirmedSourceRegion[];
}

export interface ContentCleanupProvenance {
  readonly helper_blocks_removed: number;
  readonly input_sha256: string;
  readonly output_sha256: string;
  readonly printed_toc_regions_removed: number;
}

export function firstActiveHeadingAfterSourceRegion(input: {
  readonly preparedDocument: PreparedDocument;
  readonly region: ConfirmedSourceRegion;
}): string | undefined {
  const activeHeadingIds = new Set(
    input.preparedDocument.active.headings.map((heading) => heading.blockId),
  );
  const sourceIndex = new SourceTextIndex(input.preparedDocument.full.source);
  return input.preparedDocument.full.headings.find((heading) => {
    const start = heading.position?.start.offset;
    return (
      start !== undefined &&
      activeHeadingIds.has(heading.blockId) &&
      sourceIndex.byteOffsetAt(start) >= input.region.range.end_byte
    );
  })?.blockId;
}

interface ExistingBlockIdentity {
  readonly blockId: string;
  readonly textFingerprint: string;
  readonly type: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function postorderBlockIdentities(
  root: TransientDocumentNode,
): readonly ExistingBlockIdentity[] {
  const identities: ExistingBlockIdentity[] = [];
  const visit = (node: TransientDocumentNode): void => {
    for (const child of node.children ?? []) visit(child);
    if (node.blockId && node.textFingerprint) {
      identities.push({
        blockId: node.blockId,
        textFingerprint: node.textFingerprint,
        type: node.type,
      });
    }
  };
  visit(root);
  return identities;
}

function removedCharacterRanges(
  document: NormalizedDocument,
  excludedRootIndexes: ReadonlySet<number>,
): readonly { readonly end: number; readonly start: number }[] {
  const roots = document.root.children ?? [];
  const indexes = [...excludedRootIndexes].sort((left, right) => left - right);
  const ranges: { end: number; start: number }[] = [];
  for (const index of indexes) {
    const root = roots[index];
    const start = root?.position?.start.offset;
    const end = root?.position?.end.offset;
    if (start === undefined || end === undefined || start >= end) {
      throw new Error("PREPARED_DOCUMENT_REMOVAL_POSITION_MISSING");
    }
    const previous = ranges.at(-1);
    if (previous && index > 0 && excludedRootIndexes.has(index - 1)) {
      previous.end = end;
    } else {
      ranges.push({ end, start });
    }
  }
  return ranges;
}

function isImageOnlyRoot(node: TransientDocumentNode | undefined): boolean {
  if (!node) return false;
  if (node.type === "image") return true;
  if (node.type !== "paragraph" || node.children?.length !== 1) return false;
  const child = node.children[0];
  if (child?.type === "image") return true;
  return (
    child?.type === "link" &&
    child.children?.length === 1 &&
    child.children[0]?.type === "image"
  );
}

const helperDetailsStart =
  /^<details(?:\s[^>]*)?>\s*<summary(?:\s[^>]*)?>\s*(?:flowchart|text_image|scatter)\s*<\/summary>\s*$/iu;
const helperDetailsEnd = /^\s*<\/details>\s*$/iu;
const maximumHelperRoots = 12;

function emptyHeadingRootIndexes(
  document: NormalizedDocument,
): ReadonlySet<number> {
  return new Set(
    (document.root.children ?? []).flatMap((root, index) =>
      root.type === "heading" && !(root.visibleText ?? "").trim()
        ? [index]
        : [],
    ),
  );
}

function mineruHelperRootIndexes(
  document: NormalizedDocument,
  alreadyExcluded: ReadonlySet<number>,
): ReadonlySet<number> {
  const roots = document.root.children ?? [];
  const excluded = new Set<number>();
  for (let start = 1; start < roots.length; start += 1) {
    if (alreadyExcluded.has(start) || alreadyExcluded.has(start - 1)) continue;
    const opening = roots[start];
    if (
      !isImageOnlyRoot(roots[start - 1]) ||
      opening?.type !== "html" ||
      !helperDetailsStart.test(opening.value ?? "")
    ) {
      continue;
    }
    const limit = Math.min(roots.length, start + maximumHelperRoots);
    let end = -1;
    for (let index = start + 1; index < limit; index += 1) {
      const root = roots[index];
      if (alreadyExcluded.has(index)) break;
      if (root?.type === "html" && helperDetailsEnd.test(root.value ?? "")) {
        end = index;
        break;
      }
    }
    if (end < 0) continue;
    for (let index = start; index <= end; index += 1) excluded.add(index);
    start = end;
  }
  return excluded;
}

function retainedDocumentRoot(
  document: NormalizedDocument,
  excludedRootIndexes: ReadonlySet<number>,
): TransientDocumentNode {
  return Object.freeze({
    ...document.root,
    children: Object.freeze(
      (document.root.children ?? []).filter(
        (_, index) => !excludedRootIndexes.has(index),
      ),
    ),
  });
}

function removeRanges(
  source: string,
  ranges: readonly { readonly end: number; readonly start: number }[],
): string {
  let cursor = 0;
  const parts: string[] = [];
  for (const range of ranges) {
    parts.push(source.slice(cursor, range.start));
    cursor = range.end;
  }
  parts.push(source.slice(cursor));
  return parts.join("");
}

export function prepareActiveDocument(input: {
  readonly cleanupInputSha256?: string;
  readonly document: NormalizedDocument;
  readonly mainMarkdownPath: string;
  readonly mainMarkdownSha256: string;
  readonly regions: readonly ConfirmedSourceRegion[];
}): PreparedDocument {
  const applied = applySourceRegions({
    document: input.document,
    mainMarkdownPath: input.mainMarkdownPath,
    mainMarkdownSha256: input.mainMarkdownSha256,
    regions: input.regions,
  });
  const helperRootIndexes = mineruHelperRootIndexes(
    input.document,
    applied.excludedRootIndexes,
  );
  const emptyHeadingIndexes = emptyHeadingRootIndexes(input.document);
  const cleanupRootIndexes = new Set([
    ...helperRootIndexes,
    ...emptyHeadingIndexes,
  ]);
  const excludedRootIndexes = new Set([
    ...applied.excludedRootIndexes,
    ...cleanupRootIndexes,
  ]);
  const activeMarkdown = removeRanges(
    input.document.source,
    removedCharacterRanges(input.document, excludedRootIndexes),
  );
  const identities = postorderBlockIdentities(
    retainedDocumentRoot(input.document, excludedRootIndexes),
  );
  let identityIndex = 0;
  const active = normalizeDocumentBlocks(
    parseMarkdownDocument(activeMarkdown),
    {
      idFactory(node, identity) {
        const existing = identities[identityIndex++];
        if (
          !existing ||
          existing.type !== node.type ||
          existing.textFingerprint !== identity.textFingerprint
        ) {
          throw new Error("PREPARED_DOCUMENT_IDENTITY_ALIGNMENT_INVALID");
        }
        return existing.blockId;
      },
    },
  );
  if (
    identityIndex !== identities.length ||
    active.blocks.length === 0 ||
    sha256(input.document.source) !== input.mainMarkdownSha256
  ) {
    throw new Error("PREPARED_DOCUMENT_IDENTITY_ALIGNMENT_INVALID");
  }
  return Object.freeze({
    active,
    activeMarkdown,
    cleanup: Object.freeze({
      helper_blocks_removed: cleanupRootIndexes.size,
      input_sha256: input.cleanupInputSha256 ?? input.mainMarkdownSha256,
      output_sha256: sha256(activeMarkdown),
      printed_toc_regions_removed: input.regions.length,
    }),
    full: input.document,
    removedRegions: Object.freeze([...input.regions]),
  });
}
