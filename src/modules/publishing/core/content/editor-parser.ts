import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { SafeApplicationError } from "@/domain/errors";
import type {
  ParsedDocument,
  SemanticContainerKind,
  TransientDocumentNode,
} from "../preparation/document-model";

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkDirective);
const containerKinds = new Set([
  "definition",
  "theorem",
  "proof",
  "example",
  "exercise",
  "solution",
  "note",
  "warning",
  "aside",
  "algorithm",
]);

export function parseEditorDocument(value: string): ParsedDocument {
  function convert(value: unknown): TransientDocumentNode {
    const node = value as TransientDocumentNode & { name?: string };
    const result = { ...node };
    Reflect.deleteProperty(result, "position");
    if (node.children)
      Object.assign(result, { children: node.children.map(convert) });
    if (node.type === "containerDirective") {
      if (!node.name || !containerKinds.has(node.name))
        throw new SafeApplicationError(
          "CONTENT_EDIT_UNSUPPORTED",
          "The container kind is unsupported.",
          400,
        );
      return {
        type: "semanticContainer",
        containerKind: node.name as SemanticContainerKind,
        children: result.children ?? [],
      };
    }
    return result;
  }
  return { root: convert(processor.parse(value)) };
}
