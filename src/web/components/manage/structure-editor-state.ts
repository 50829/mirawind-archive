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

function structureRoles(
  nodes: readonly EditableStructureNode[],
  boundaries: StructureBoundaries,
): StructurePreviewNode["role"][] {
  const bodyStart = nodes.findIndex(
    (node) => node.block_id === boundaries.body_start_block_id,
  );
  const appendixStart = boundaries.appendix_start_block_id
    ? nodes.findIndex(
        (node) => node.block_id === boundaries.appendix_start_block_id,
      )
    : -1;
  const backmatterStart = boundaries.backmatter_start_block_id
    ? nodes.findIndex(
        (node) => node.block_id === boundaries.backmatter_start_block_id,
      )
    : -1;
  return nodes.map((_node, index) => {
    if (backmatterStart >= 0 && index >= backmatterStart) return "backmatter";
    if (appendixStart >= 0 && index >= appendixStart) return "appendix";
    if (bodyStart >= 0 && index < bodyStart) return "frontmatter";
    return "body";
  });
}

function generatedNumbers(
  nodes: readonly EditableStructureNode[],
  roles: readonly StructurePreviewNode["role"][],
): readonly (string | null)[] {
  const counters = [0, 0, 0, 0];
  let baseLevel: number | null = null;
  return nodes.map((node, index) => {
    if (roles[index] !== "body") return null;
    if (baseLevel === null || node.display_level < baseLevel) {
      baseLevel = node.display_level;
    }
    const counterIndex = node.display_level - baseLevel;
    counters[counterIndex] = (counters[counterIndex] ?? 0) + 1;
    counters.fill(0, counterIndex + 1);
    return counters
      .slice(0, counterIndex + 1)
      .map(String)
      .join(".");
  });
}

export function buildStructurePreview(
  nodes: readonly EditableStructureNode[],
  boundaries: StructureBoundaries,
  numbering: HeadingNumberingMode,
): readonly StructurePreviewNode[] {
  const roles = structureRoles(nodes, boundaries);
  const generated = generatedNumbers(nodes, roles);
  return nodes.map((node, index) => {
    const number =
      numbering === "none"
        ? null
        : numbering === "source"
          ? (node.source_number ?? null)
          : generated[index];
    return Object.freeze({
      ...node,
      number: number ?? null,
      preview_title: [number, node.title_markdown].filter(Boolean).join(" "),
      role: roles[index] ?? "body",
    });
  });
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
