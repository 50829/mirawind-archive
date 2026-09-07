import katex from "katex";
import type { ReactNode } from "react";
import { useMemo } from "react";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

interface MarkdownNode {
  readonly alt?: string;
  readonly children?: readonly MarkdownNode[];
  readonly type: string;
  readonly value?: string;
}

function renderFormula(source: string, displayMode: boolean): string {
  return katex.renderToString(source, {
    displayMode,
    output: "htmlAndMathml",
    strict: "ignore",
    throwOnError: false,
    trust: false,
  });
}

function renderNodes(
  nodes: readonly MarkdownNode[],
  path = "title",
): ReactNode {
  return nodes.map((node, index) => {
    const key = `${path}:${index}:${node.type}`;
    if (node.type === "text") return node.value ?? "";
    if (node.type === "inlineMath" && node.value !== undefined) {
      return (
        <span
          className="structure-title-formula"
          dangerouslySetInnerHTML={{ __html: renderFormula(node.value, false) }}
          key={key}
        />
      );
    }
    if (node.type === "inlineCode") {
      return <code key={key}>{node.value}</code>;
    }
    if (node.type === "strong") {
      return <strong key={key}>{renderNodes(node.children ?? [], key)}</strong>;
    }
    if (node.type === "emphasis") {
      return <em key={key}>{renderNodes(node.children ?? [], key)}</em>;
    }
    if (node.type === "delete") {
      return <del key={key}>{renderNodes(node.children ?? [], key)}</del>;
    }
    if (node.type === "break") return <br key={key} />;
    if (node.type === "image") return node.alt ?? "";
    if (node.children) {
      return <span key={key}>{renderNodes(node.children, key)}</span>;
    }
    return node.value ?? "";
  });
}

function headingChildren(markdown: string): readonly MarkdownNode[] {
  const tree = unified()
    .use(remarkParse)
    .use(remarkMath)
    .parse(`# ${markdown}\n`) as unknown as MarkdownNode;
  const heading = tree.children?.find((node) => node.type === "heading");
  return heading?.children ?? [{ type: "text", value: markdown }];
}

export function RichStructureTitle(props: { readonly markdown: string }) {
  const nodes = useMemo(
    () => headingChildren(props.markdown),
    [props.markdown],
  );
  return <>{renderNodes(nodes)}</>;
}

export function FormulaTrial(props: {
  readonly displayMode?: boolean;
  readonly source: string;
}) {
  const html = useMemo(
    () => renderFormula(props.source, props.displayMode ?? true),
    [props.displayMode, props.source],
  );
  return (
    <div
      className="formula-trial overflow-auto rounded-md border border-stone-200 bg-stone-50 p-4 text-stone-900"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
