export type ContentRole = "frontmatter" | "body" | "appendix" | "backmatter";

export interface EditableStructureNode {
  readonly block_id: string;
  readonly display_level: number;
  readonly display_title?: string;
  readonly include_in_toc: boolean;
  readonly role?: ContentRole;
  readonly starts_page: boolean;
}

export function changeDisplayLevel(
  node: EditableStructureNode,
  displayLevel: number,
): EditableStructureNode {
  if (displayLevel === 1) return { ...node, display_level: displayLevel };
  const changed = { ...node, display_level: displayLevel };
  Reflect.deleteProperty(changed, "role");
  return changed;
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
    ] as const) {
      if (localNode[key] !== submittedNode[key]) merged[key] = localNode[key];
    }
    for (const key of ["display_title", "role"] as const) {
      if (localNode[key] === submittedNode[key]) continue;
      if (localNode[key] === undefined) Reflect.deleteProperty(merged, key);
      else merged[key] = localNode[key];
    }
    return merged as unknown as EditableStructureNode;
  });
}
