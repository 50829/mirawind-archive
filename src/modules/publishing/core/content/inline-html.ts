import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { encodeHTML } from "entities";
import type { BookDocument, InlineNode } from "./book-document.generated";
import { inlineText } from "./content-tree";
import { SafeApplicationError } from "@/domain/errors";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMath from "remark-math";
import type { TransientDocumentNode } from "../preparation/document-model";

const mathParser = unified().use(remarkParse).use(remarkMath);
mathParser.data("micromarkExtensions", [
  {
    disable: {
      null: [
        "attention",
        "autolink",
        "blockQuote",
        "characterEscape",
        "characterReference",
        "codeFenced",
        "codeIndented",
        "codeText",
        "definition",
        "hardBreakEscape",
        "headingAtx",
        "htmlFlow",
        "htmlText",
        "labelEnd",
        "labelStartImage",
        "labelStartLink",
        "list",
        "setextUnderline",
        "thematicBreak",
      ],
    },
  },
]);

function tableText(value: string): InlineNode[] {
  if (!value.includes("$")) return [{ type: "text", text: value }];
  function convert(node: TransientDocumentNode): InlineNode[] {
    if (node.type === "text") return [{ type: "text", text: node.value ?? "" }];
    if (node.type === "math" || node.type === "inlineMath")
      return [{ type: "math", latex: node.value ?? "" }];
    return (node.children ?? []).flatMap(convert);
  }
  return convert(mathParser.parse(value) as unknown as TransientDocumentNode);
}

type HtmlNode = DefaultTreeAdapterMap["node"];
function invalid(): never {
  throw new SafeApplicationError(
    "CONTENT_INLINE_INVALID",
    "This edit contains unsupported inline content.",
    400,
  );
}

export function inlineFromHtmlNodes(
  nodes: readonly HtmlNode[],
  resourceIdForPath: (path: string) => string,
  parseMath = false,
): InlineNode[] {
  return nodes.flatMap((node): InlineNode[] => {
    if ("value" in node && node.nodeName === "#text")
      return parseMath
        ? tableText(node.value)
        : [{ type: "text", text: node.value }];
    if (!("tagName" in node)) invalid();
    const attr = (key: string) =>
      node.attrs.find((item) => item.name === key)?.value;
    const content = inlineFromHtmlNodes(
      node.childNodes,
      resourceIdForPath,
      parseMath &&
        node.tagName !== "code" &&
        !(attr("class") ?? "").split(/\s+/u).includes("math-inline"),
    );
    const marks: Readonly<
      Record<
        string,
        | "strong"
        | "emphasis"
        | "delete"
        | "subscript"
        | "superscript"
        | "underline"
      >
    > = {
      b: "strong",
      strong: "strong",
      i: "emphasis",
      em: "emphasis",
      s: "delete",
      del: "delete",
      sub: "subscript",
      sup: "superscript",
      u: "underline",
    };
    const footnote = attr("data-footnote-ref");
    if (node.tagName === "sup" && footnote)
      return [{ type: "footnote_reference", target_id: footnote }];
    const mark = marks[node.tagName];
    if (mark) return [{ type: mark, content }];
    if (node.tagName === "br") return [{ type: "break" }];
    if (node.tagName === "code")
      return [{ type: "code", code: inlineText(content) }];
    if (node.tagName === "img")
      return [
        {
          type: "image",
          resource_id: resourceIdForPath(attr("src") ?? ""),
          alt: attr("alt") ?? "",
        },
      ];
    if (node.tagName === "span")
      return (attr("class") ?? "").split(/\s+/u).includes("math-inline")
        ? [{ type: "math", latex: inlineText(content) }]
        : content;
    if (node.tagName === "p" || node.tagName === "div") return content;
    if (node.tagName === "a") {
      const url = attr("href");
      if (!url) return content;
      const target: Extract<InlineNode, { type: "link" }>["target"] =
        url.startsWith("#blk_")
          ? { type: "block", block_id: url.slice(1) }
          : /^(https?:|mailto:)/iu.test(url)
            ? { type: "external", url }
            : { type: "resource", resource_id: resourceIdForPath(url) };
      return [{ type: "link", target, content }];
    }
    invalid();
  });
}

export function parseInlineHtml(
  html: string,
  book: Pick<BookDocument, "resources">,
): InlineNode[] {
  return inlineFromHtmlNodes(
    parseFragment(html).childNodes,
    (path) =>
      book.resources.find((item) => item.path === path)?.id ?? invalid(),
  );
}

export function inlineHtml(
  nodes: readonly InlineNode[],
  book: Pick<BookDocument, "resources">,
): string {
  const path = (id: string) =>
    book.resources.find((item) => item.id === id)?.path ?? invalid();
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
          return encodeHTML(node.text);
        case "math":
          return (
            '<span class="math-inline">' + encodeHTML(node.latex) + "</span>"
          );
        case "code":
          return "<code>" + encodeHTML(node.code) + "</code>";
        case "break":
          return "<br>";
        case "image":
          return (
            '<img src="' +
            encodeHTML(path(node.resource_id)) +
            '" alt="' +
            encodeHTML(node.alt) +
            '">'
          );
        case "footnote_reference":
          return (
            '<sup data-footnote-ref="' + encodeHTML(node.target_id) + '"></sup>'
          );
        case "link":
          return (
            '<a href="' +
            encodeHTML(
              node.target.type === "external"
                ? node.target.url
                : node.target.type === "block"
                  ? "#" + node.target.block_id
                  : path(node.target.resource_id),
            ) +
            '">' +
            inlineHtml(node.content, book) +
            "</a>"
          );
        default: {
          const tags = {
            emphasis: "em",
            strong: "strong",
            delete: "del",
            subscript: "sub",
            superscript: "sup",
            underline: "u",
          };
          const tag = tags[node.type];
          return (
            "<" + tag + ">" + inlineHtml(node.content, book) + "</" + tag + ">"
          );
        }
      }
    })
    .join("");
}
