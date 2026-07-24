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
      aside: [
        "ariaLabel",
        "className",
        "dataBlockId",
        ["dataContainerKind", ...allowedSemanticKinds],
      ],
      code: [
        [
          "className",
          /^language-[A-Za-z0-9_-]+$/u,
          "math-inline",
          "math-display",
          "math-fallback",
        ],
      ],
      div: [
        ...(defaultSchema.attributes?.div ?? []),
        "className",
        "dataBlockId",
      ],
      figure: ["dataBlockId"],
      h1: [...(defaultSchema.attributes?.h1 ?? []), "dataBlockId"],
      h2: [...(defaultSchema.attributes?.h2 ?? []), "dataBlockId"],
      h3: [...(defaultSchema.attributes?.h3 ?? []), "dataBlockId"],
      h4: [...(defaultSchema.attributes?.h4 ?? []), "dataBlockId"],
      img: [...(defaultSchema.attributes?.img ?? []), "dataMirawindResource"],
      li: [...(defaultSchema.attributes?.li ?? []), "dataBlockId"],
      p: [...(defaultSchema.attributes?.p ?? []), "dataBlockId"],
      pre: [...(defaultSchema.attributes?.pre ?? []), "dataBlockId"],
      table: [...(defaultSchema.attributes?.table ?? []), "dataBlockId"],
    },
    tagNames: [
      ...(defaultSchema.tagNames ?? []),
      "aside",
      "figcaption",
      "figure",
    ],
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
