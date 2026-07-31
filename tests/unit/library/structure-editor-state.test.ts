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
      include_in_toc: true,
      starts_page: true,
      title_markdown: "Submitted title",
    };
    const submitted: readonly EditableStructureNode[] = [submittedNode];
    const server: readonly EditableStructureNode[] = submitted.map((node) => ({
      ...node,
    }));
    const local: readonly EditableStructureNode[] = [
      changeDisplayLevel(
        {
          ...submittedNode,
          title_markdown: "Typed after submit",
        },
        2,
      ),
    ];

    expect(mergeAcceptedNodes(server, submitted, local)).toEqual([
      expect.objectContaining({
        display_level: 2,
        include_in_toc: true,
        title_markdown: "Typed after submit",
      }),
    ]);
  });

  it("keeps unsaved edits when an unrelated source revision arrives", () => {
    const previous: readonly EditableStructureNode[] = [
      {
        block_id: "blk_structure_editor_state_0003",
        display_level: 1,
        include_in_toc: true,
        starts_page: true,
        title_markdown: "Server title",
      },
    ];
    const server = previous.map((node) => ({
      ...node,
      source_number: "Chapter 1",
    }));
    const local = previous.map((node) => ({
      ...node,
      display_level: 2,
      title_markdown: "Unsaved title",
    }));

    expect(mergeAcceptedNodes(server, previous, local)).toEqual([
      expect.objectContaining({
        display_level: 2,
        source_number: "Chapter 1",
        title_markdown: "Unsaved title",
      }),
    ]);
  });

  it("changes only the selected heading level", () => {
    expect(
      changeDisplayLevel(
        {
          block_id: "blk_structure_editor_state_0002",
          display_level: 1,
          include_in_toc: true,
          starts_page: true,
          title_markdown: "Appendix",
        },
        3,
      ),
    ).toEqual({
      block_id: "blk_structure_editor_state_0002",
      display_level: 3,
      include_in_toc: true,
      starts_page: true,
      title_markdown: "Appendix",
    });
  });
});
