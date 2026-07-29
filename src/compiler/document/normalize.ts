import { createHash } from "node:crypto";

import { createOpaqueId } from "@/domain/ids";
import type {
  NormalizedDocument,
  ParsedDocument,
  TransientDocumentNode,
} from "@/compiler/document/types";

const blockTypes = new Set([
  "blockquote",
  "code",
  "footnoteDefinition",
  "heading",
  "image",
  "listItem",
  "math",
  "paragraph",
  "semanticContainer",
  "table",
]);

function normalizedVisibleText(node: TransientDocumentNode): string {
  const values: string[] = [];
  const visit = (current: TransientDocumentNode) => {
    if (
      (current.type === "text" ||
        current.type === "inlineCode" ||
        current.type === "code" ||
        current.type === "inlineMath" ||
        current.type === "math") &&
      current.value
    ) {
      values.push(current.value);
    } else if (current.type === "image" && current.alt) {
      values.push(current.alt);
    } else if (current.type === "break") {
      values.push("\n");
    }
    for (const child of current.children ?? []) visit(child);
  };
  visit(node);
  return values
    .join("")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .normalize("NFC");
}

function fingerprint(type: string, visibleText: string): string {
  return `tfp_v1_${createHash("sha256")
    .update("mirawind-visible-text-v1\0")
    .update(type)
    .update("\0")
    .update(visibleText)
    .digest("base64url")}`;
}

export function normalizeDocumentBlocks(
  document: ParsedDocument,
  options: {
    readonly idFactory?: (node: TransientDocumentNode) => string;
  } = {},
): NormalizedDocument {
  const blocks: TransientDocumentNode[] = [];
  const normalize = (node: TransientDocumentNode): TransientDocumentNode => {
    const children = node.children?.map(normalize);
    const withChildren = Object.freeze({
      ...node,
      ...(children ? { children: Object.freeze(children) } : {}),
    });
    if (!blockTypes.has(node.type)) return withChildren;
    const visibleText = normalizedVisibleText(withChildren);
    const block = Object.freeze({
      ...withChildren,
      blockId: options.idFactory?.(node) ?? createOpaqueId("block"),
      textFingerprint: fingerprint(node.type, visibleText),
      visibleText,
    });
    blocks.push(block);
    return block;
  };
  const root = normalize(document.root);
  blocks.sort(
    (left, right) =>
      (left.position?.start.offset ?? Number.POSITIVE_INFINITY) -
        (right.position?.start.offset ?? Number.POSITIVE_INFINITY) ||
      (right.position?.end.offset ?? Number.NEGATIVE_INFINITY) -
        (left.position?.end.offset ?? Number.NEGATIVE_INFINITY),
  );
  const headings = blocks.flatMap((block) =>
    block.type === "heading" &&
    block.blockId &&
    block.depth &&
    block.textFingerprint
      ? [
          Object.freeze({
            blockId: block.blockId,
            level: block.depth,
            ...(block.position ? { position: block.position } : {}),
            sourceTitle: block.visibleText ?? "",
            textFingerprint: block.textFingerprint,
          }),
        ]
      : [],
  );
  return Object.freeze({
    blocks: Object.freeze(blocks),
    headings: Object.freeze(headings),
    root,
    source: document.source,
  });
}
