import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { createOpaqueId } from "@/domain/ids";
import { SafeApplicationError } from "@/domain/errors";
import type {
  BookDocument,
  ContentBlock,
  InlineNode,
  TableBlock,
  TableCell,
} from "./book-document.generated";
import { inlineFromHtmlNodes, inlineHtml } from "./inline-html";

type HtmlNode = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
function invalid(): never {
  throw new SafeApplicationError(
    "CONTENT_TABLE_INVALID",
    "The table contains unsupported or malformed content.",
    400,
  );
}
function children(node: HtmlNode): readonly HtmlNode[] {
  return "childNodes" in node ? node.childNodes : [];
}
function attr(node: Element, key: string): string | undefined {
  return node.attrs.find((item) => item.name === key)?.value;
}

export function parseTableHtml(
  html: string,
  resourceIdForPath: (path: string) => string,
  parseMath = false,
): TableCell[][] {
  function inlines(node: HtmlNode): InlineNode[] {
    return inlineFromHtmlNodes([node], resourceIdForPath, parseMath);
  }
  function blocks(nodes: readonly HtmlNode[]): ContentBlock[] {
    const output: ContentBlock[] = [];
    let pending: InlineNode[] = [];
    const flush = () => {
      if (!pending.length) return;
      output.push({
        id: createOpaqueId("block"),
        type: "paragraph",
        content: pending,
      });
      pending = [];
    };
    for (const node of nodes) {
      if ("tagName" in node && node.tagName === "table") {
        flush();
        output.push({
          id: createOpaqueId("block"),
          type: "table",
          rows: rows(node),
        });
      } else if ("tagName" in node && ["div", "p"].includes(node.tagName)) {
        flush();
        output.push(...blocks(children(node)));
      } else pending.push(...inlines(node));
    }
    flush();
    return output;
  }
  function rows(table: Element): TableCell[][] {
    const output: TableCell[][] = [];
    function visit(node: HtmlNode): void {
      if ("tagName" in node && node.tagName === "tr") {
        const row = node.childNodes.filter(
          (child): child is Element =>
            "tagName" in child && ["td", "th"].includes(child.tagName),
        );
        output.push(
          row.map((cell) => {
            const align = attr(cell, "align");
            return {
              content: blocks(cell.childNodes),
              header: cell.tagName === "th",
              row_span: Number(attr(cell, "rowspan") ?? 1),
              col_span: Number(attr(cell, "colspan") ?? 1),
              ...(align === "left" || align === "center" || align === "right"
                ? { align }
                : {}),
            };
          }),
        );
        return;
      }
      for (const child of children(node)) visit(child);
    }
    visit(table);
    if (!output.length) invalid();
    return output;
  }
  const root = parseFragment(html);
  const roots = root.childNodes.filter(
    (node) =>
      node.nodeName !== "#text" || ("value" in node && node.value.trim()),
  );
  const first = roots[0];
  if (
    roots.length !== 1 ||
    !first ||
    !("tagName" in first) ||
    first.tagName !== "table"
  )
    invalid();
  return rows(first);
}

export function tableEditorHtml(
  table: TableBlock,
  book: Pick<BookDocument, "resources">,
): string {
  function inline(nodes: readonly InlineNode[]): string {
    return inlineHtml(nodes, book);
  }
  function body(block: ContentBlock): string {
    if (block.type === "paragraph")
      return "<p>" + inline(block.content) + "</p>";
    if (block.type === "table") return tableEditorHtml(block, book);
    invalid();
  }
  return (
    "<table>\n" +
    table.rows
      .map(
        (row) =>
          "<tr>" +
          row
            .map((cell) => {
              const tag = cell.header ? "th" : "td";
              return (
                "<" +
                tag +
                ' rowspan="' +
                cell.row_span +
                '" colspan="' +
                cell.col_span +
                '"' +
                (cell.align ? ' align="' + cell.align + '"' : "") +
                ">" +
                cell.content.map(body).join("") +
                "</" +
                tag +
                ">"
              );
            })
            .join("") +
          "</tr>",
      )
      .join("\n") +
    "\n</table>"
  );
}
