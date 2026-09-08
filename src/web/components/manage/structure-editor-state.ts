import {
  presentBookHeadings,
  type HeadingNumberingMode,
} from "@/modules/publishing/application/heading-api";

export interface EditableStructureNode {
  readonly alias?: string;
  readonly block_id: string;
  readonly display_level: number;
  readonly include_in_toc: boolean;
  readonly exclude_from_numbering: boolean;
  readonly source_number?: string;
  readonly starts_page: boolean;
  readonly title_markdown: string;
}

export interface StructureBoundaries {
  readonly appendix_start_block_id?: string;
  readonly backmatter_start_block_id?: string;
  readonly body_start_block_id: string;
}

export interface StructurePreviewNode extends EditableStructureNode {
  readonly number: string | null;
  readonly preview_title: string;
  readonly role: "appendix" | "backmatter" | "body" | "frontmatter";
}

export type { HeadingNumberingMode };

export function buildStructurePreview(
  nodes: readonly EditableStructureNode[],
  boundaries: StructureBoundaries,
  numbering: HeadingNumberingMode,
): readonly StructurePreviewNode[] {
  const headings = presentBookHeadings({
    blocks: nodes.map((node) => ({
      id: node.block_id,
      type: "heading",
      level: node.display_level,
      content: [{ type: "text", text: node.title_markdown }],
      include_in_toc: node.include_in_toc,
      starts_page: node.starts_page,
      exclude_from_numbering: node.exclude_from_numbering,
      ...(node.source_number ? { source_number: node.source_number } : {}),
    })),
    publishing: { numbering, boundaries, code: { line_numbers: false } },
  });
  return nodes.map((node, index) => ({
    ...node,
    number: headings[index]?.number ?? null,
    preview_title: headings[index]?.label ?? node.title_markdown,
    role: headings[index]?.role ?? "body",
  }));
}

export function mergeAcceptedNumbering(
  server: HeadingNumberingMode,
  submitted: HeadingNumberingMode,
  local: HeadingNumberingMode,
): HeadingNumberingMode {
  return local === submitted ? server : local;
}

export function changeDisplayLevel(
  node: EditableStructureNode,
  displayLevel: number,
): EditableStructureNode {
  return { ...node, display_level: displayLevel };
}

export function mergeAcceptedNodes(
  server: readonly EditableStructureNode[],
  submitted: readonly EditableStructureNode[],
  local: readonly EditableStructureNode[],
): readonly EditableStructureNode[] {
  const submittedById = new Map(submitted.map((node) => [node.block_id, node]));
  const localById = new Map(local.map((node) => [node.block_id, node]));
  return server.map((serverNode) => {
    const submittedNode = submittedById.get(serverNode.block_id);
    const localNode = localById.get(serverNode.block_id);
    if (!submittedNode || !localNode) return serverNode;
    const merged: Record<string, unknown> = { ...serverNode };
    for (const key of [
      "display_level",
      "include_in_toc",
      "exclude_from_numbering",
      "starts_page",
      "title_markdown",
    ] as const) {
      if (localNode[key] !== submittedNode[key]) merged[key] = localNode[key];
    }
    for (const key of ["alias", "source_number"] as const) {
      if (localNode[key] === submittedNode[key]) continue;
      if (localNode[key] === undefined) Reflect.deleteProperty(merged, key);
      else merged[key] = localNode[key];
    }
    return merged as unknown as EditableStructureNode;
  });
}
