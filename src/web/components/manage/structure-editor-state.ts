import type { HeadingNumberingMode } from "@/modules/publishing/application/publishing-api";

export interface EditableStructureNode {
  readonly alias?: string;
  readonly block_id: string;
  readonly display_level: number;
  readonly include_in_toc: boolean;
  readonly source_number?: string;
  readonly starts_page: boolean;
  readonly title_markdown: string;
}

export type { HeadingNumberingMode };

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
