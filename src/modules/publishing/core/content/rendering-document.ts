import type {
  BookDocument,
  ContentBlock,
  InlineNode,
} from "./book-document.generated";
import { blockText, contentEntries } from "./content-tree";
import type {
  NormalizedDocument,
  TransientDocumentNode,
} from "../preparation/document-model";

export function renderingInline(
  content: readonly InlineNode[],
  book: Pick<BookDocument, "resources">,
): TransientDocumentNode[] {
  return content.map((node) => {
    switch (node.type) {
      case "text":
        return { type: "text", value: node.text };
      case "code":
        return { type: "inlineCode", value: node.code };
      case "math":
        return { type: "inlineMath", value: node.latex };
      case "break":
        return { type: "break" };
      case "image":
        return {
          type: "image",
          url:
            book.resources.find((resource) => resource.id === node.resource_id)
              ?.path ?? "",
          alt: node.alt,
        };
      case "footnote_reference":
        return { type: "footnoteReference", identifier: node.target_id };
      case "subscript":
      case "superscript":
      case "underline":
        return {
          type: `content-${node.type}`,
          data: {
            hName:
              node.type === "subscript"
                ? "sub"
                : node.type === "superscript"
                  ? "sup"
                  : "u",
          },
          children: renderingInline(node.content, book),
        };
      case "link": {
        const target = node.target;
        return {
          type: "link",
          url:
            target.type === "external"
              ? target.url
              : target.type === "block"
                ? `#${target.block_id}`
                : (book.resources.find(
                    (resource) => resource.id === target.resource_id,
                  )?.path ?? ""),
          children: renderingInline(node.content, book),
        };
      }
      default:
        return {
          type: node.type,
          children: renderingInline(node.content, book),
        };
    }
  });
}

export function createRenderingDocument(
  book: BookDocument,
): NormalizedDocument {
  const byId = new Map<string, TransientDocumentNode>();
  const elements = (
    name: string,
    children: readonly TransientDocumentNode[],
    properties?: Readonly<Record<string, unknown>>,
  ): TransientDocumentNode => ({
    type: `content-${name}`,
    data: { hName: name, ...(properties ? { hProperties: properties } : {}) },
    children,
  });
  function convert(block: ContentBlock): TransientDocumentNode {
    let node: TransientDocumentNode;
    switch (block.type) {
      case "paragraph":
        node = {
          type: "paragraph",
          children: renderingInline(block.content, book),
        };
        break;
      case "heading":
        node = {
          type: "heading",
          depth: block.level,
          children: renderingInline(block.content, book),
        };
        break;
      case "code":
        node = block.caption?.length
          ? elements("figure", [
              elements("figcaption", renderingInline(block.caption, book)),
              { type: "code", lang: block.language, value: block.code },
            ])
          : { type: "code", lang: block.language, value: block.code };
        break;
      case "math":
        node = { type: "math", value: block.latex };
        break;
      case "image":
        node = elements("figure", [
          {
            type: "image",
            url:
              book.resources.find(
                (resource) => resource.id === block.resource_id,
              )?.path ?? "",
            alt: block.alt,
          },
          ...(block.caption?.length
            ? [elements("figcaption", renderingInline(block.caption, book))]
            : []),
          ...(block.notes ?? []).map(convert),
        ]);
        break;
      case "list":
        node = {
          type: "list",
          ordered: block.ordered,
          ...(block.start !== undefined ? { start: block.start } : {}),
          children: block.items.map((item) => {
            const child: TransientDocumentNode = {
              type: "listItem",
              contentKind: "list_item",
              blockId: item.id,
              visibleText: blockText(item),
              ...(item.checked !== undefined ? { checked: item.checked } : {}),
              children: item.content.map(convert),
            };
            byId.set(item.id, child);
            return child;
          }),
        };
        break;
      case "quote":
        node = { type: "blockquote", children: block.content.map(convert) };
        break;
      case "footnote":
        node = {
          type: "footnoteDefinition",
          identifier: block.id,
          children: block.content.map(convert),
        };
        break;
      case "container":
        node = elements("aside", block.content.map(convert), {
          className: ["semantic-container", `semantic-${block.kind}`],
          dataContainerKind: block.kind,
          ariaLabel: block.kind,
        });
        break;
      case "divider":
        node = { type: "thematicBreak" };
        break;
      case "table":
        node = elements(
          "div",
          [
            elements("table", [
              ...(block.caption?.length
                ? [elements("caption", renderingInline(block.caption, book))]
                : []),
              elements(
                "tbody",
                block.rows.map((row) =>
                  elements(
                    "tr",
                    row.map((cell) =>
                      elements(
                        cell.header ? "th" : "td",
                        cell.content.map(convert),
                        {
                          rowSpan: cell.row_span,
                          colSpan: cell.col_span,
                          ...(cell.align ? { align: cell.align } : {}),
                        },
                      ),
                    ),
                  ),
                ),
              ),
            ]),
            ...(block.notes ?? []).map(convert),
          ],
          { className: ["table-scroll"] },
        );
        break;
    }
    node = {
      ...node,
      blockId: block.id,
      contentKind: block.type,
      visibleText: blockText(block),
    };
    byId.set(block.id, node);
    return node;
  }
  const roots = book.blocks.map(convert);
  const blocks = [...contentEntries(book.blocks)].map(({ node }) => {
    const rendered = byId.get(node.id);
    if (!rendered) throw new Error("CONTENT_RENDER_NODE_MISSING");
    return rendered;
  });
  return {
    root: { type: "root", children: roots },
    blocks,
    headings: blocks.flatMap((block) =>
      block.type === "heading" && block.blockId && block.depth
        ? [
            {
              blockId: block.blockId,
              level: block.depth,
              sourceTitle: block.visibleText ?? "",
            },
          ]
        : [],
    ),
  };
}
