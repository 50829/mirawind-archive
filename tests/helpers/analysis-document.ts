import { createOpaqueId } from "@/domain/ids";
import type {
  NormalizedDocument,
  NormalizedHeading,
  ParsedDocument,
  TransientDocumentNode,
} from "@/modules/publishing/core/preparation/document-model";

// Private analysis algorithms accept transient trees, not persisted book documents.
export function analysisDocument(
  parsed: ParsedDocument,
  options: { idFactory?: (node: TransientDocumentNode) => string } = {},
): NormalizedDocument {
  const blocks: TransientDocumentNode[] = [];
  const headings: NormalizedHeading[] = [];
  const blockTypes = new Set([
    "heading",
    "paragraph",
    "blockquote",
    "list",
    "listItem",
    "code",
    "math",
    "image",
    "table",
    "footnoteDefinition",
    "semanticContainer",
    "html",
    "thematicBreak",
  ]);
  const text = (node: TransientDocumentNode): string =>
    node.value ??
    node.alt ??
    (node.children ?? [])
      .map(text)
      .join(
        ["list", "listItem", "table", "tableRow", "blockquote"].includes(
          node.type,
        )
          ? "\n"
          : "",
      );
  const visit = (input: TransientDocumentNode): TransientDocumentNode => {
    const node = {
      ...input,
      visibleText: text(input),
      ...(blockTypes.has(input.type)
        ? { blockId: options.idFactory?.(input) ?? createOpaqueId("block") }
        : {}),
    };
    Reflect.deleteProperty(node, "position");
    if (node.blockId) {
      blocks.push(node);
      if (node.type === "heading")
        headings.push({
          blockId: node.blockId,
          level: node.depth ?? 1,
          sourceTitle: text(node).normalize("NFC"),
        });
    }
    if (input.children)
      Object.assign(node, { children: input.children.map(visit) });
    return node;
  };
  return { root: visit(parsed.root), blocks, headings };
}
