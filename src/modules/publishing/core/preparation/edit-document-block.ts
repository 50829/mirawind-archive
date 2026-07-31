import type { SourceBlockRecord } from "@/modules/publishing/core/preparation/source-block-records";
import { normalizeDocumentBlocks } from "@/modules/publishing/core/preparation/normalize-document";
import { parseMarkdownDocument } from "@/modules/publishing/core/preparation/parse-markdown";

export interface EditedDocumentBlock {
  readonly blocks: readonly SourceBlockRecord[];
  readonly markdown: string;
  readonly selectedBlockId: string | null;
}

function identityKey(input: {
  readonly end_offset: number;
  readonly kind: string;
  readonly start_offset: number;
  readonly text_fingerprint: string;
}): string {
  return [
    input.kind,
    input.start_offset,
    input.end_offset,
    input.text_fingerprint,
  ].join("\0");
}

function positionKey(input: {
  readonly end_offset: number;
  readonly kind: string;
  readonly start_offset: number;
}): string {
  return [input.kind, input.start_offset, input.end_offset].join("\0");
}

export function editDocumentBlock(input: {
  readonly blockId: string;
  readonly blocks: readonly SourceBlockRecord[];
  readonly markdown: string;
  readonly replacement: string;
}): EditedDocumentBlock {
  const selected = input.blocks.find(
    (block) => block.block_id === input.blockId,
  );
  if (!selected || selected.kind === "heading") {
    throw new Error("SOURCE_BLOCK_NOT_EDITABLE");
  }
  if (
    selected.start_offset < 0 ||
    selected.end_offset > input.markdown.length ||
    selected.start_offset >= selected.end_offset
  ) {
    throw new Error("SOURCE_BLOCK_RANGE_INVALID");
  }

  const nextMarkdown =
    input.markdown.slice(0, selected.start_offset) +
    input.replacement +
    input.markdown.slice(selected.end_offset);
  const normalized = normalizeDocumentBlocks(
    parseMarkdownDocument(nextMarkdown),
  );
  if (normalized.blocks.length === 0) {
    throw new Error("SOURCE_DOCUMENT_EMPTY");
  }

  const delta =
    input.replacement.length - (selected.end_offset - selected.start_offset);
  const replacementEnd = selected.start_offset + input.replacement.length;
  const oldByIdentity = new Map(
    input.blocks.map((block) => [identityKey(block), block] as const),
  );
  const oldByPosition = new Map(
    input.blocks.map((block) => [positionKey(block), block] as const),
  );
  const oldInsideByIdentity = new Map<string, SourceBlockRecord[]>();
  for (const block of input.blocks) {
    if (
      block.start_offset < selected.start_offset ||
      block.end_offset > selected.end_offset
    ) {
      continue;
    }
    const key = [block.kind, block.text_fingerprint].join("\0");
    const values = oldInsideByIdentity.get(key) ?? [];
    values.push(block);
    oldInsideByIdentity.set(key, values);
  }

  const usedOldIds = new Set<string>();
  let replacementFirstId: string | null = null;
  const blocks = normalized.blocks.map((block) => {
    if (!block.blockId || !block.position || !block.textFingerprint) {
      throw new Error("SOURCE_BLOCK_IDENTITY_MISSING");
    }
    const current = {
      end_offset: block.position.end.offset,
      kind: block.type,
      start_offset: block.position.start.offset,
      text_fingerprint: block.textFingerprint,
    };
    let mapped: SourceBlockRecord | undefined;
    if (current.end_offset <= selected.start_offset) {
      mapped = oldByIdentity.get(identityKey(current));
    } else if (current.start_offset >= replacementEnd) {
      mapped = oldByIdentity.get(
        identityKey({
          ...current,
          end_offset: current.end_offset - delta,
          start_offset: current.start_offset - delta,
        }),
      );
    } else if (
      current.start_offset <= selected.start_offset &&
      current.end_offset >= replacementEnd
    ) {
      mapped = oldByPosition.get(
        positionKey({
          ...current,
          end_offset: current.end_offset - delta,
        }),
      );
    }
    if (
      !mapped &&
      current.start_offset === selected.start_offset &&
      current.end_offset === replacementEnd &&
      current.kind === selected.kind
    ) {
      mapped = selected;
    }
    if (
      !mapped &&
      current.start_offset >= selected.start_offset &&
      current.end_offset <= replacementEnd
    ) {
      mapped = oldInsideByIdentity
        .get([current.kind, current.text_fingerprint].join("\0"))
        ?.find((candidate) => !usedOldIds.has(candidate.block_id));
    }
    const blockId =
      mapped && !usedOldIds.has(mapped.block_id)
        ? mapped.block_id
        : block.blockId;
    if (mapped) usedOldIds.add(blockId);
    if (
      replacementFirstId === null &&
      current.start_offset >= selected.start_offset &&
      current.end_offset <= replacementEnd
    ) {
      replacementFirstId = blockId;
    }
    return Object.freeze({
      block_id: blockId,
      ...current,
    });
  });

  const oldHeadingIds = input.blocks
    .filter((block) => block.kind === "heading")
    .map((block) => block.block_id);
  const newHeadingIds = blocks
    .filter((block) => block.kind === "heading")
    .map((block) => block.block_id);
  if (
    oldHeadingIds.length !== newHeadingIds.length ||
    oldHeadingIds.some((blockId, index) => blockId !== newHeadingIds[index])
  ) {
    throw new Error("SOURCE_EDIT_HEADING_CHANGE_FORBIDDEN");
  }

  return Object.freeze({
    blocks: Object.freeze(blocks),
    markdown: nextMarkdown,
    selectedBlockId: usedOldIds.has(selected.block_id)
      ? selected.block_id
      : replacementFirstId,
  });
}
