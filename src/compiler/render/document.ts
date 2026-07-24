import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

import type { SafeDiagnostic } from "../../domain/errors.js";
import type {
  NormalizedDocument,
  TransientDocumentNode,
} from "../document/types.js";
import type { ResourceResolution } from "../resources/resolver.js";
import { renderCode } from "./code.js";
import { renderMath } from "./math.js";
import {
  importedHtmlSanitizationSchema,
  rehypeRestrictResources,
} from "./sanitize.js";

interface TreeNode {
  alt?: string;
  blockId?: string;
  children?: TreeNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
  };
  depth?: number;
  identifier?: string;
  lang?: string | null;
  properties?: Record<string, unknown>;
  tagName?: string;
  title?: string | null;
  type: string;
  url?: string;
  value?: string;
  [key: string]: unknown;
}

export interface HeadingRenderOverride {
  readonly displayLevel: number;
  readonly displayTitle: string;
  readonly number?: string | null;
}

export interface SemanticRenderResult {
  readonly css: string;
  readonly diagnostics: readonly SafeDiagnostic[];
  readonly html: string;
}

export interface RenderSemanticDocumentOptions {
  readonly document: NormalizedDocument;
  readonly headingHref?: (blockId: string) => string;
  readonly headingOverrides?: ReadonlyMap<string, HeadingRenderOverride>;
  readonly publishedResourceUrl: (resourceId: string) => string;
  readonly resourceResolution: ResourceResolution;
}

const blockIdPattern = /^blk_[A-Za-z0-9_-]{16,80}$/u;
const forbiddenTags = new Set(["embed", "iframe", "object", "script"]);

function assertSafePublishedUrl(url: string): void {
  if (
    !url.startsWith("/") ||
    url.startsWith("//") ||
    [...url].some((character) => (character.codePointAt(0) ?? 0) < 32)
  ) {
    throw new TypeError(
      "Published resource URL must be a safe same-origin path",
    );
  }
}

function rendererTree(
  options: RenderSemanticDocumentOptions,
  diagnostics: SafeDiagnostic[],
): TreeNode {
  const resourceIdByOriginalUrl = new Map(
    options.resourceResolution.references.map((reference) => [
      reference.originalUrl,
      reference.resourceId,
    ]),
  );
  const resourceUrls = new Map<string, string>();
  for (const resource of options.resourceResolution.resources) {
    const url = options.publishedResourceUrl(resource.id);
    assertSafePublishedUrl(url);
    resourceUrls.set(resource.id, url);
  }
  const definitions = new Map<string, string>();
  const collectDefinitions = (node: TransientDocumentNode) => {
    if (node.type === "definition" && node.identifier && node.url) {
      definitions.set(node.identifier.toUpperCase(), node.url);
    }
    for (const child of node.children ?? []) collectDefinitions(child);
  };
  collectDefinitions(options.document.root);

  const clone = (node: TransientDocumentNode): TreeNode => {
    const { children, ...properties } = node;
    const output: TreeNode = {
      ...properties,
      ...(children ? { children: children.map(clone) } : {}),
    };
    if (node.blockId) {
      output.data = {
        hProperties: { dataBlockId: node.blockId },
      };
    }

    if (node.type === "heading" && node.blockId) {
      const override = options.headingOverrides?.get(node.blockId);
      const depth = override?.displayLevel ?? node.depth;
      if (depth !== undefined) output.depth = depth;
      output.data = {
        hProperties: {
          dataBlockId: node.blockId,
          id: node.blockId,
        },
      };
      if (override) {
        output.children = [
          ...(override.number
            ? [
                {
                  children: [{ type: "text", value: `${override.number} ` }],
                  data: {
                    hName: "span",
                    hProperties: { className: ["heading-number"] },
                  },
                  type: "mirawindHeadingNumber",
                },
              ]
            : []),
          { type: "text", value: override.displayTitle },
        ];
      }
    } else if (
      (node.type === "inlineMath" || node.type === "math") &&
      node.value !== undefined
    ) {
      const rendered = renderMath({
        ...(node.blockId ? { blockId: node.blockId } : {}),
        displayMode: node.type === "math",
        source: node.value,
      });
      if (rendered.diagnostic) {
        diagnostics.push(rendered.diagnostic);
        if (node.type === "inlineMath") {
          output.data = {
            hName: "code",
            hProperties: { className: ["math-fallback"] },
          };
          output.children = [{ type: "text", value: rendered.source }];
        } else {
          output.data = {
            hName: "div",
            hProperties: {
              className: ["math-fallback"],
              ...(node.blockId ? { dataBlockId: node.blockId } : {}),
            },
          };
          output.children = [
            {
              children: [
                {
                  children: [{ type: "text", value: rendered.source }],
                  data: {
                    hName: "code",
                    hProperties: { className: ["math-fallback"] },
                  },
                  type: "mirawindMathFallbackCode",
                },
              ],
              data: { hName: "pre" },
              type: "mirawindMathFallback",
            },
          ];
        }
        delete output.value;
      } else if (node.type === "inlineMath") {
        output.data = {
          hName: "code",
          hProperties: {
            className: ["language-math", "math-inline"],
          },
        };
        output.children = [{ type: "text", value: node.value }];
        delete output.value;
      } else {
        output.data = {
          hName: "div",
          hProperties: {
            className: ["math-block"],
            ...(node.blockId ? { dataBlockId: node.blockId } : {}),
          },
        };
        output.children = [
          {
            children: [
              {
                children: [{ type: "text", value: node.value }],
                data: {
                  hName: "code",
                  hProperties: {
                    className: ["language-math", "math-display"],
                  },
                },
                type: "mirawindMathCode",
              },
            ],
            data: { hName: "pre" },
            type: "mirawindMathPre",
          },
        ];
        delete output.value;
      }
    } else if (node.type === "semanticContainer" && node.containerKind) {
      output.data = {
        hName: "aside",
        hProperties: {
          ariaLabel: node.containerKind,
          className: ["semantic-container", `semantic-${node.containerKind}`],
          dataContainerKind: node.containerKind,
          ...(node.blockId ? { dataBlockId: node.blockId } : {}),
        },
      };
    }

    if (node.type === "image" || node.type === "imageReference") {
      const originalUrl =
        node.type === "image"
          ? node.url
          : node.identifier
            ? definitions.get(node.identifier.toUpperCase())
            : undefined;
      const resourceId = originalUrl
        ? resourceIdByOriginalUrl.get(originalUrl)
        : undefined;
      const publishedUrl = resourceId
        ? resourceUrls.get(resourceId)
        : undefined;
      if (resourceId && publishedUrl) {
        output.data = {
          ...(output.data ?? {}),
          hProperties: {
            ...(output.data?.hProperties ?? {}),
            dataMirawindResource: resourceId,
          },
        };
        if (node.type === "image") output.url = publishedUrl;
      } else if (node.type === "image") {
        output.url = "";
      }
    }
    if (node.type === "definition" && node.url) {
      const resourceId = resourceIdByOriginalUrl.get(node.url);
      const publishedUrl = resourceId
        ? resourceUrls.get(resourceId)
        : undefined;
      if (publishedUrl) output.url = publishedUrl;
    }
    return output;
  };

  const root = clone(options.document.root);
  const turnImagesIntoFigures = (node: TreeNode) => {
    for (const child of node.children ?? []) turnImagesIntoFigures(child);
    if (
      node.type !== "paragraph" ||
      node.children?.length !== 1 ||
      !["image", "imageReference"].includes(node.children[0]?.type ?? "")
    ) {
      return;
    }
    const image = node.children[0];
    if (!image) return;
    const caption = image.title || image.alt;
    node.data = {
      hName: "figure",
      hProperties: {
        ...(node.blockId ? { dataBlockId: node.blockId } : {}),
      },
    };
    node.type = "mirawindFigure";
    if (caption) {
      image.title = null;
      node.children.push({
        children: [{ type: "text", value: caption }],
        data: { hName: "figcaption" },
        type: "mirawindFigureCaption",
      });
    }
  };
  turnImagesIntoFigures(root);
  Object.defineProperty(root, "_resourceUrls", {
    enumerable: false,
    value: resourceUrls,
  });
  return root;
}

async function highlightCodeBlocks(
  tree: TreeNode,
  diagnostics: SafeDiagnostic[],
  codeBlockIds: readonly string[],
): Promise<string> {
  const css: string[] = [];
  let codeBlockIndex = 0;
  const visit = async (node: TreeNode): Promise<void> => {
    if (node.children) {
      for (let index = 0; index < node.children.length; index += 1) {
        const child = node.children[index];
        if (
          child?.type === "element" &&
          child.tagName === "pre" &&
          child.children?.length === 1
        ) {
          const code = child.children[0];
          const classes = Array.isArray(code?.properties?.className)
            ? code.properties.className
            : [];
          const languageClass = classes.find(
            (value): value is string =>
              typeof value === "string" && value.startsWith("language-"),
          );
          if (
            code?.type === "element" &&
            code.tagName === "code" &&
            languageClass &&
            languageClass !== "language-math"
          ) {
            const blockId = codeBlockIds[codeBlockIndex++];
            const source = (code.children ?? [])
              .map((part) => (part.type === "text" ? (part.value ?? "") : ""))
              .join("");
            const rendered = await renderCode({
              ...(blockId ? { blockId } : {}),
              language: languageClass.slice("language-".length),
              source,
            });
            node.children[index] = rendered.tree as TreeNode;
            if (rendered.css) css.push(rendered.css);
            if (rendered.diagnostic) diagnostics.push(rendered.diagnostic);
            continue;
          }
        }
        if (child) await visit(child);
      }
    }
  };
  await visit(tree);
  return [...new Set(css)].sort().join("");
}

function restoreStableHeadingIds(tree: TreeNode): void {
  const visit = (node: TreeNode) => {
    if (
      node.type === "element" &&
      /^h[1-4]$/u.test(node.tagName ?? "") &&
      typeof node.properties?.dataBlockId === "string" &&
      blockIdPattern.test(node.properties.dataBlockId)
    ) {
      node.properties.id = node.properties.dataBlockId;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
}

function repairFootnoteLinks(
  tree: TreeNode,
  footnoteBlockIds: readonly string[],
): void {
  const normalizeId = (value: string) =>
    value.replace(/^(?:user-content-){2,}/u, "user-content-");
  let footnoteIndex = 0;
  const visit = (node: TreeNode, insideFootnotes = false) => {
    const isFootnotes =
      insideFootnotes ||
      (node.type === "element" &&
        Object.hasOwn(node.properties ?? {}, "dataFootnotes"));
    if (node.type === "element") {
      const properties = node.properties ?? {};
      const id = properties.id;
      if (typeof id === "string") properties.id = normalizeId(id);
      const href = properties.href;
      if (typeof href === "string" && href.startsWith("#")) {
        properties.href = `#${normalizeId(href.slice(1))}`;
      }
      if (Object.hasOwn(properties, "dataFootnoteRef")) {
        properties.role = "doc-noteref";
      } else if (isFootnotes && node.tagName === "li") {
        properties.role = "doc-endnote";
        const blockId = footnoteBlockIds[footnoteIndex++];
        if (blockId) properties.dataBlockId = blockId;
      }
      node.properties = properties;
    }
    for (const child of node.children ?? []) visit(child, isFootnotes);
  };
  visit(tree);
}

function headingSlug(value: string): string {
  return value
    .normalize("NFC")
    .trim()
    .toLocaleLowerCase("en")
    .replaceAll(/[^\p{Letter}\p{Number}\s_-]/gu, "")
    .replaceAll(/\s+/gu, "-")
    .replaceAll(/-+/gu, "-");
}

function repairInternalHeadingLinks(
  tree: TreeNode,
  document: NormalizedDocument,
  overrides: ReadonlyMap<string, HeadingRenderOverride> | undefined,
  headingHref: ((blockId: string) => string) | undefined,
): void {
  const headingIds = new Set(
    document.headings.map((heading) => heading.blockId),
  );
  const targets = new Map<string, string>();
  for (const heading of document.headings) {
    const override = overrides?.get(heading.blockId);
    for (const title of [
      heading.sourceTitle,
      ...(override ? [override.displayTitle] : []),
    ]) {
      const slug = headingSlug(title);
      if (slug && !targets.has(slug)) targets.set(slug, heading.blockId);
    }
  }
  const visit = (node: TreeNode) => {
    if (
      node.type === "element" &&
      node.tagName === "a" &&
      typeof node.properties?.href === "string" &&
      node.properties.href.startsWith("#") &&
      !Object.hasOwn(node.properties, "dataFootnoteRef") &&
      !Object.hasOwn(node.properties, "dataFootnoteBackref")
    ) {
      const rawTarget = node.properties.href.slice(1);
      let decoded = rawTarget;
      try {
        decoded = decodeURIComponent(rawTarget);
      } catch {
        // Keep the literal fragment; an unresolved link fails below.
      }
      const target = headingIds.has(decoded)
        ? decoded
        : targets.get(headingSlug(decoded));
      if (!target) throw new Error("INTERNAL_HEADING_LINK_UNRESOLVED");
      const href = headingHref?.(target) ?? `#${target}`;
      if (
        !href.startsWith("/") &&
        !href.startsWith("#") &&
        !/^[1-9][0-9]*#[A-Za-z0-9_-]+$/u.test(href)
      ) {
        throw new TypeError("Heading URL must be a safe publication path");
      }
      node.properties.href = href;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
}

function assertPostRenderInvariants(tree: TreeNode): void {
  const ids = new Set<string>();
  const visit = (node: TreeNode) => {
    if (node.type === "element") {
      if (forbiddenTags.has(node.tagName ?? "")) {
        throw new Error("Forbidden element survived semantic rendering");
      }
      const id = node.properties?.id;
      if (typeof id === "string") {
        if (ids.has(id)) throw new Error("Duplicate rendered element ID");
        ids.add(id);
      }
      const source = node.properties?.src;
      if (typeof source === "string" && /^(?:[a-z]+:)?\/\//iu.test(source)) {
        throw new Error("External resource URL survived semantic rendering");
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
}

export async function renderSemanticDocument(
  options: RenderSemanticDocumentOptions,
): Promise<SemanticRenderResult> {
  const diagnostics: SafeDiagnostic[] = [
    ...options.resourceResolution.diagnostics,
  ];
  const tree = rendererTree(options, diagnostics);
  const resourceUrls = (
    tree as TreeNode & {
      _resourceUrls: ReadonlyMap<string, string>;
    }
  )._resourceUrls;
  const processor = unified()
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeRestrictResources, { allowedResourceUrls: resourceUrls })
    .use(rehypeSanitize, importedHtmlSanitizationSchema)
    .use(rehypeKatex, {
      maxExpand: 1_000,
      maxSize: 50,
      strict: "error",
      trust: false,
    });
  const transformed = (await processor.run(tree as never)) as TreeNode;
  restoreStableHeadingIds(transformed);
  repairFootnoteLinks(
    transformed,
    options.document.blocks.flatMap((block) =>
      block.type === "footnoteDefinition" && block.blockId
        ? [block.blockId]
        : [],
    ),
  );
  repairInternalHeadingLinks(
    transformed,
    options.document,
    options.headingOverrides,
    options.headingHref,
  );
  const css = await highlightCodeBlocks(
    transformed,
    diagnostics,
    options.document.blocks.flatMap((block) =>
      block.type === "code" && block.blockId ? [block.blockId] : [],
    ),
  );
  assertPostRenderInvariants(transformed);
  const html = unified()
    .use(rehypeStringify)
    .stringify(transformed as never);
  return Object.freeze({
    css,
    diagnostics: Object.freeze(diagnostics),
    html,
  });
}
