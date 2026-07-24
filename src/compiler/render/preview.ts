import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

import type {
  ParsedDocument,
  TransientDocumentNode,
} from "../document/types.js";
import type { ResourceResolution } from "../resources/resolver.js";
import {
  importedHtmlSanitizationSchema,
  rehypeRestrictResources,
} from "./sanitize.js";

interface RendererNode {
  alt?: string;
  children?: RendererNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
  };
  identifier?: string;
  type: string;
  url?: string;
  [key: string]: unknown;
}

export interface RenderDraftPreviewOptions {
  readonly authenticatedResourceUrl: (resourceId: string) => string;
  readonly document: ParsedDocument;
  readonly resourceResolution: ResourceResolution;
}

function assertSafeAuthenticatedUrl(url: string): void {
  if (
    !url.startsWith("/") ||
    url.startsWith("//") ||
    [...url].some((character) => (character.codePointAt(0) ?? 0) < 32)
  ) {
    throw new TypeError(
      "Authenticated resource URL must be a safe same-origin path",
    );
  }
}

function rendererTree(
  document: ParsedDocument,
  resourceResolution: ResourceResolution,
  resourceUrls: ReadonlyMap<string, string>,
): RendererNode {
  const resourceIdByOriginalUrl = new Map(
    resourceResolution.references.map((reference) => [
      reference.originalUrl,
      reference.resourceId,
    ]),
  );
  const definitions = new Map<string, string>();
  const collectDefinitions = (node: TransientDocumentNode) => {
    if (node.type === "definition" && node.identifier && node.url) {
      definitions.set(node.identifier.toUpperCase(), node.url);
    }
    for (const child of node.children ?? []) collectDefinitions(child);
  };
  collectDefinitions(document.root);

  const clone = (node: TransientDocumentNode): RendererNode => {
    const { children, ...properties } = node;
    const output: RendererNode = {
      ...properties,
      ...(children ? { children: children.map(clone) } : {}),
    };
    if (node.type === "inlineMath" && node.value !== undefined) {
      output.data = {
        hName: "code",
        hProperties: { className: ["language-math", "math-inline"] },
      };
      output.children = [{ type: "text", value: node.value }];
      delete output.value;
    } else if (node.type === "math" && node.value !== undefined) {
      output.data = { hName: "pre" };
      output.children = [
        {
          children: [{ type: "text", value: node.value }],
          data: {
            hName: "code",
            hProperties: { className: ["language-math", "math-display"] },
          },
          type: "mirawindMathCode",
        },
      ];
      delete output.value;
    }
    if (node.type === "semanticContainer" && node.containerKind) {
      output.data = {
        hName: "aside",
        hProperties: {
          className: ["semantic-container", `semantic-${node.containerKind}`],
          dataContainerKind: node.containerKind,
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
      const authenticatedUrl = resourceId
        ? resourceUrls.get(resourceId)
        : undefined;
      if (resourceId && authenticatedUrl) {
        output.data = {
          ...(output.data ?? {}),
          hProperties: {
            ...(output.data?.hProperties ?? {}),
            dataMirawindResource: resourceId,
          },
        };
        if (node.type === "image") output.url = authenticatedUrl;
      } else if (node.type === "image") {
        output.url = "";
      }
    }
    if (node.type === "definition" && node.url) {
      const resourceId = resourceIdByOriginalUrl.get(node.url);
      const authenticatedUrl = resourceId
        ? resourceUrls.get(resourceId)
        : undefined;
      if (authenticatedUrl) output.url = authenticatedUrl;
    }
    return output;
  };
  return clone(document.root);
}

export async function renderDraftPreview(
  options: RenderDraftPreviewOptions,
): Promise<string> {
  const resourceUrls = new Map<string, string>();
  for (const resource of options.resourceResolution.resources) {
    const url = options.authenticatedResourceUrl(resource.id);
    assertSafeAuthenticatedUrl(url);
    resourceUrls.set(resource.id, url);
  }
  const tree = rendererTree(
    options.document,
    options.resourceResolution,
    resourceUrls,
  );
  const processor = unified()
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeRestrictResources, { allowedResourceUrls: resourceUrls })
    .use(rehypeSanitize, importedHtmlSanitizationSchema)
    .use(rehypeKatex, {
      strict: "ignore",
      trust: false,
    })
    .use(rehypeStringify);
  const transformed = await processor.run(tree as never);
  return processor.stringify(transformed);
}
