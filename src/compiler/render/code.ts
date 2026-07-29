import { createHash } from "node:crypto";

import { transformerStyleToClass } from "@shikijs/transformers";
import { createHighlighter, type HighlighterGeneric } from "shiki";

import { createSafeDiagnostic, type SafeDiagnostic } from "@/domain/errors";

interface HastNode {
  children?: HastNode[];
  properties?: Record<string, unknown>;
  tagName?: string;
  type: string;
  value?: string;
  [key: string]: unknown;
}

export interface CodeRenderResult {
  readonly css: string;
  readonly diagnostic?: SafeDiagnostic;
  readonly language: string;
  readonly tree: HastNode;
}

const languageAliases = new Map<string, string>([
  ["bash", "bash"],
  ["c", "c"],
  ["cpp", "cpp"],
  ["css", "css"],
  ["html", "html"],
  ["javascript", "javascript"],
  ["js", "javascript"],
  ["json", "json"],
  ["jsx", "jsx"],
  ["markdown", "markdown"],
  ["md", "markdown"],
  ["python", "python"],
  ["py", "python"],
  ["shell", "bash"],
  ["sh", "bash"],
  ["sql", "sql"],
  ["text", "text"],
  ["ts", "typescript"],
  ["tsx", "tsx"],
  ["typescript", "typescript"],
  ["yaml", "yaml"],
  ["yml", "yaml"],
]);

const loadedLanguages = [
  "bash",
  "c",
  "cpp",
  "css",
  "html",
  "javascript",
  "json",
  "jsx",
  "markdown",
  "python",
  "sql",
  "tsx",
  "typescript",
  "yaml",
] as const;

let highlighterPromise: Promise<HighlighterGeneric<string, string>> | undefined;

function highlighter(): Promise<HighlighterGeneric<string, string>> {
  highlighterPromise ??= createHighlighter({
    langs: [...loadedLanguages],
    themes: ["github-light"],
  }) as Promise<HighlighterGeneric<string, string>>;
  return highlighterPromise;
}

function plainTree(source: string, blockId?: string): HastNode {
  return {
    children: [
      {
        children: [{ type: "text", value: source }],
        properties: {
          className: ["code-plain"],
          dataCodeLanguage: "plain",
        },
        tagName: "code",
        type: "element",
      },
    ],
    properties: {
      className: ["code-block", "code-plain"],
      ...(blockId ? { dataBlockId: blockId } : {}),
    },
    tagName: "pre",
    type: "element",
  };
}

function canonicalCss(
  registry: ReadonlyMap<string, string | Record<string, string>>,
): string {
  return [...registry.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([className, style]) => {
      const body =
        typeof style === "string"
          ? style
          : Object.entries(style)
              .sort(([left], [right]) => left.localeCompare(right, "en"))
              .map(([property, value]) => `${property}:${value}`)
              .join(";");
      return `.${className}{${body}}`;
    })
    .join("");
}

function extractRemainingStyles(tree: HastNode): string {
  const styles = new Map<string, string>();
  const visit = (node: HastNode) => {
    const style = node.properties?.style;
    if (typeof style === "string" && style.length > 0) {
      const className = `mw-shiki-${createHash("sha256")
        .update(style)
        .digest("base64url")
        .slice(0, 12)}`;
      styles.set(className, style);
      const current = node.properties?.className;
      node.properties = {
        ...node.properties,
        className: [
          ...(Array.isArray(current)
            ? current.filter(
                (value): value is string => typeof value === "string",
              )
            : typeof current === "string"
              ? [current]
              : []),
          className,
        ],
      };
      delete node.properties.style;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  return [...styles]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([className, style]) => `.${className}{${style}}`)
    .join("");
}

export async function renderCode(input: {
  readonly blockId?: string;
  readonly language?: string | null;
  readonly source: string;
}): Promise<CodeRenderResult> {
  const requested = input.language?.trim().toLowerCase() ?? "";
  const language = languageAliases.get(requested);
  if (!language || language === "text") {
    const diagnostic =
      requested && requested !== "text"
        ? createSafeDiagnostic({
            ...(input.blockId ? { blockId: input.blockId } : {}),
            code: "CODE_LANGUAGE_UNSUPPORTED",
            message:
              "An unsupported code language was rendered as escaped plain text.",
          })
        : undefined;
    return Object.freeze({
      css: "",
      ...(diagnostic ? { diagnostic } : {}),
      language: "plain",
      tree: plainTree(input.source, input.blockId),
    });
  }

  const styleTransformer = transformerStyleToClass({
    classPrefix: "mw-shiki-",
  });
  const instance = await highlighter();
  const tree = instance.codeToHast(input.source, {
    lang: language,
    theme: "github-light",
    transformers: [styleTransformer],
  }) as HastNode;
  const pre = tree.children?.find(
    (node) => node.type === "element" && node.tagName === "pre",
  );
  const code = pre?.children?.find(
    (node) => node.type === "element" && node.tagName === "code",
  );
  if (code) {
    code.properties = {
      ...code.properties,
      dataCodeLanguage: language,
    };
  }
  if (pre && input.blockId) {
    pre.properties = {
      ...pre.properties,
      dataBlockId: input.blockId,
    };
  }
  return Object.freeze({
    css:
      canonicalCss(styleTransformer.getClassRegistry()) +
      extractRemainingStyles(tree),
    language,
    tree,
  });
}
