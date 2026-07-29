import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { SafeApplicationError } from "@/domain/errors";
import type {
  ParsedDocument,
  SemanticContainerKind,
  SourcePosition,
  TransientDocumentNode,
} from "@/compiler/document/types";

const containerKinds = new Set<SemanticContainerKind>([
  "definition",
  "theorem",
  "proof",
  "example",
  "exercise",
  "solution",
  "note",
  "warning",
]);

interface ContainerRange {
  readonly closeStart: number;
  readonly contentStart: number;
  readonly end: number;
  readonly kind: SemanticContainerKind;
  readonly start: number;
}

export class DocumentParseError extends SafeApplicationError {
  constructor(
    code: "MARKDOWN_CONTAINER_INVALID" | "MARKDOWN_INVALID_UTF8",
    message: string,
  ) {
    super(code, message, 400);
    this.name = "DocumentParseError";
  }
}

function decodeSource(input: string | Uint8Array): string {
  if (typeof input === "string") return input.replace(/^\uFEFF/u, "");
  try {
    return new TextDecoder("utf-8", { fatal: true })
      .decode(input)
      .replace(/^\uFEFF/u, "");
  } catch {
    throw new DocumentParseError(
      "MARKDOWN_INVALID_UTF8",
      "The main Markdown is not valid UTF-8.",
    );
  }
}

function containerRanges(source: string): {
  readonly masked: string;
  readonly ranges: readonly ContainerRange[];
} {
  const characters = source.split("");
  const ranges: ContainerRange[] = [];
  const stack: {
    readonly contentStart: number;
    readonly kind: SemanticContainerKind;
    readonly start: number;
  }[] = [];
  const linePattern =
    /^(?<indent>[ \t]*)(?<marker>:::)(?:[ \t]+(?<kind>[a-z]+))?[ \t]*$/gmu;
  let match: RegExpExecArray | null;
  while ((match = linePattern.exec(source))) {
    const kind = match.groups?.kind;
    const start = match.index;
    const end = start + match[0].length;
    if (kind) {
      if (!containerKinds.has(kind as SemanticContainerKind)) continue;
      const lineEnd = source.indexOf("\n", end);
      stack.push({
        contentStart: lineEnd === -1 ? end : lineEnd + 1,
        kind: kind as SemanticContainerKind,
        start,
      });
    } else {
      const opening = stack.pop();
      if (!opening) {
        throw new DocumentParseError(
          "MARKDOWN_CONTAINER_INVALID",
          "A semantic container has an unmatched closing marker.",
        );
      }
      ranges.push({
        closeStart: start,
        contentStart: opening.contentStart,
        end,
        kind: opening.kind,
        start: opening.start,
      });
    }
    for (let index = start; index < end; index += 1) {
      if (characters[index] !== "\n") characters[index] = " ";
    }
  }
  if (stack.length > 0) {
    throw new DocumentParseError(
      "MARKDOWN_CONTAINER_INVALID",
      "A semantic container has no closing marker.",
    );
  }
  return {
    masked: characters.join(""),
    ranges: Object.freeze(
      ranges.sort((left, right) => left.start - right.start),
    ),
  };
}

function pointAt(source: string, offset: number) {
  const before = source.slice(0, offset);
  const lines = before.split("\n");
  return Object.freeze({
    column: (lines.at(-1)?.length ?? 0) + 1,
    line: lines.length,
    offset,
  });
}

function positionFor(
  source: string,
  start: number,
  end: number,
): SourcePosition {
  return Object.freeze({
    end: pointAt(source, end),
    start: pointAt(source, start),
  });
}

function cloneNode(input: unknown): TransientDocumentNode {
  if (!input || typeof input !== "object" || !("type" in input)) {
    throw new Error("Markdown parser returned an invalid node");
  }
  const node = input as Record<string, unknown>;
  const children = Array.isArray(node.children)
    ? node.children.map(cloneNode)
    : undefined;
  const position =
    node.position &&
    typeof node.position === "object" &&
    "start" in node.position &&
    "end" in node.position
      ? (node.position as SourcePosition)
      : undefined;
  return Object.freeze({
    ...(typeof node.alt === "string" ? { alt: node.alt } : {}),
    ...(typeof node.checked === "boolean" || node.checked === null
      ? { checked: node.checked }
      : {}),
    ...(children ? { children: Object.freeze(children) } : {}),
    ...(typeof node.depth === "number" ? { depth: node.depth } : {}),
    ...(typeof node.identifier === "string"
      ? { identifier: node.identifier }
      : {}),
    ...(typeof node.lang === "string" || node.lang === null
      ? { lang: node.lang }
      : {}),
    ...(typeof node.ordered === "boolean" || node.ordered === null
      ? { ordered: node.ordered }
      : {}),
    ...(position ? { position } : {}),
    ...(typeof node.spread === "boolean" ? { spread: node.spread } : {}),
    ...(typeof node.title === "string" || node.title === null
      ? { title: node.title }
      : {}),
    type: String(node.type),
    ...(typeof node.url === "string" ? { url: node.url } : {}),
    ...(typeof node.value === "string" ? { value: node.value } : {}),
  });
}

function wrapContainers(
  children: readonly TransientDocumentNode[],
  ranges: readonly ContainerRange[],
  source: string,
): readonly TransientDocumentNode[] {
  if (ranges.length === 0) return children;
  const outerRanges = ranges.filter(
    (range) =>
      !ranges.some(
        (other) =>
          other !== range &&
          other.contentStart <= range.start &&
          other.closeStart >= range.end,
      ),
  );
  const output: TransientDocumentNode[] = [];
  let childIndex = 0;
  for (const range of outerRanges) {
    while (
      childIndex < children.length &&
      (children[childIndex]?.position?.start.offset ??
        Number.POSITIVE_INFINITY) < range.contentStart
    ) {
      const child = children[childIndex++];
      if (child) output.push(child);
    }
    const contained: TransientDocumentNode[] = [];
    while (
      childIndex < children.length &&
      (children[childIndex]?.position?.end.offset ??
        Number.POSITIVE_INFINITY) <= range.closeStart
    ) {
      const child = children[childIndex++];
      if (child) contained.push(child);
    }
    const nested = ranges.filter(
      (candidate) =>
        candidate !== range &&
        candidate.start >= range.contentStart &&
        candidate.end <= range.closeStart,
    );
    output.push(
      Object.freeze({
        children: Object.freeze(wrapContainers(contained, nested, source)),
        containerKind: range.kind,
        position: positionFor(source, range.start, range.end),
        type: "semanticContainer",
      }),
    );
  }
  output.push(...children.slice(childIndex));
  return Object.freeze(output);
}

export function parseMarkdownDocument(
  input: string | Uint8Array,
): ParsedDocument {
  const source = decodeSource(input);
  const containers = containerRanges(source);
  const parsed = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .parse(containers.masked);
  const root = cloneNode(parsed);
  return Object.freeze({
    root: Object.freeze({
      ...root,
      children: wrapContainers(root.children ?? [], containers.ranges, source),
    }),
    source,
  });
}
