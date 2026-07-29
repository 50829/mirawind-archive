import { describe, expect, it } from "vitest";

import {
  changeDisplayLevel,
  mergeAcceptedNodes,
  type EditableStructureNode,
} from "@/web/components/manage/structure-editor-state";

describe("publishing workbench local edit retention", () => {
  it("keeps only edits made after the accepted save snapshot", () => {
    const submittedNode: EditableStructureNode = {
      block_id: "blk_structure_editor_state_0001",
      display_level: 1,
      display_title: "Submitted title",
      include_in_toc: true,
      role: "body",
      starts_page: true,
    };
    const submitted: readonly EditableStructureNode[] = [submittedNode];
    const server: readonly EditableStructureNode[] = submitted.map((node) => ({
      ...node,
    }));
    const local: readonly EditableStructureNode[] = [
      changeDisplayLevel(
        {
          ...submittedNode,
          display_title: "Typed after submit",
        },
        2,
      ),
    ];

    expect(mergeAcceptedNodes(server, submitted, local)).toEqual([
      expect.objectContaining({
        display_level: 2,
        display_title: "Typed after submit",
        include_in_toc: true,
      }),
    ]);
    expect(local[0]).not.toHaveProperty("role");
  });

  it("removes a top-level role when a heading moves below H1", () => {
    expect(
      changeDisplayLevel(
        {
          block_id: "blk_structure_editor_state_0002",
          display_level: 1,
          include_in_toc: true,
          role: "appendix",
          starts_page: true,
        },
        3,
      ),
    ).toEqual({
      block_id: "blk_structure_editor_state_0002",
      display_level: 3,
      include_in_toc: true,
      starts_page: true,
    });
  });
});
