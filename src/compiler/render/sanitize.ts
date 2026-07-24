import {
  defaultSchema,
  type Options as SanitizationSchema,
} from "rehype-sanitize";

interface HastNode {
  children?: HastNode[];
  properties?: Record<string, unknown>;
  tagName?: string;
  type: string;
}

const allowedSemanticKinds = new Set([
  "definition",
  "example",
  "exercise",
  "note",
  "proof",
  "solution",
  "theorem",
  "warning",
]);

export const importedHtmlSanitizationSchema: SanitizationSchema = Object.freeze(
  {
    ...defaultSchema,
    attributes: {
      ...defaultSchema.attributes,
      aside: ["className", ["dataContainerKind", ...allowedSemanticKinds]],
      code: [
        [
          "className",
          /^language-[A-Za-z0-9_-]+$/u,
          "math-inline",
          "math-display",
        ],
      ],
      img: [...(defaultSchema.attributes?.img ?? []), "dataMirawindResource"],
    },
    tagNames: [...(defaultSchema.tagNames ?? []), "aside"],
  } as SanitizationSchema,
);

function visit(
  node: HastNode,
  allowedResourceUrls: ReadonlyMap<string, string>,
): void {
  if (!node.children) return;
  node.children = node.children.flatMap((child) => {
    if (child.type === "element" && child.tagName === "img") {
      const marker = child.properties?.dataMirawindResource;
      const source = child.properties?.src;
      if (
        typeof marker !== "string" ||
        typeof source !== "string" ||
        allowedResourceUrls.get(marker) !== source
      ) {
        return [];
      }
    }
    visit(child, allowedResourceUrls);
    return [child];
  });
}

/**
 * Removes every image that did not originate from the contained resource resolver.
 * This runs after raw HTML parsing and before the general sanitization allowlist.
 */
export function rehypeRestrictResources(options: {
  readonly allowedResourceUrls: ReadonlyMap<string, string>;
}): (tree: HastNode) => void {
  return (tree) => visit(tree, options.allowedResourceUrls);
}
