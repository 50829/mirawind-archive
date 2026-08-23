import type { TransientDocumentNode } from "../preparation/document-model";
import { parseMarkdownDocument } from "../preparation/parse-markdown";

export interface ParsedHeadingMarkdown {
  readonly children: readonly TransientDocumentNode[];
  readonly text: string;
}

function visibleText(nodes: readonly TransientDocumentNode[]): string {
  const values: string[] = [];
  const visit = (node: TransientDocumentNode): void => {
    if (
      (node.type === "text" ||
        node.type === "inlineCode" ||
        node.type === "inlineMath") &&
      node.value
    ) {
      values.push(node.value);
    } else if (node.type === "image" && node.alt) {
      values.push(node.alt);
    }
    for (const child of node.children ?? []) visit(child);
  };
  for (const node of nodes) visit(node);
  return values.join("").trim();
}

export function parseHeadingMarkdown(value: string): ParsedHeadingMarkdown {
  if (!value.trim() || /[\r\n]/u.test(value)) {
    throw new Error("HEADING_MARKDOWN_INVALID");
  }
  const document = parseMarkdownDocument(`# ${value}\n`);
  const roots = document.root.children ?? [];
  const heading = roots[0];
  if (
    roots.length !== 1 ||
    heading?.type !== "heading" ||
    heading.depth !== 1 ||
    !heading.children
  ) {
    throw new Error("HEADING_MARKDOWN_INVALID");
  }
  const text = visibleText(heading.children);
  if (!text) throw new Error("HEADING_MARKDOWN_INVALID");
  return Object.freeze({ children: heading.children, text });
}
