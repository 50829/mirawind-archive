import { describe, expect, it } from "vitest";

import {
  buildStructurePreview,
  changeDisplayLevel,
  mergeAcceptedNodes,
  mergeAcceptedNumbering,
  type EditableStructureNode,
} from "@/web/components/manage/structure-editor-state";

describe("publishing workbench local edit retention", () => {
  it("previews source, generated, and hidden numbering without changing source data", () => {
    const nodes: readonly EditableStructureNode[] = [
      {
        block_id: "blk_structure_editor_state_frontmatter",
        display_level: 1,
        exclude_from_numbering: false,
        include_in_toc: true,
        source_number: "P",
        starts_page: true,
        title_markdown: "Preface",
      },
      {
        block_id: "blk_structure_editor_state_body",
        display_level: 1,
        exclude_from_numbering: false,
        include_in_toc: true,
        source_number: "Chapter 9",
        starts_page: true,
        title_markdown: "Body",
      },
      {
        block_id: "blk_structure_editor_state_child",
        display_level: 2,
        exclude_from_numbering: false,
        include_in_toc: false,
        source_number: "Section 42",
        starts_page: false,
        title_markdown: "Child",
      },
      {
        block_id: "blk_structure_editor_state_appendix",
        display_level: 1,
        exclude_from_numbering: false,
        include_in_toc: true,
        source_number: "Appendix A",
        starts_page: true,
        title_markdown: "Appendix",
      },
    ];
    const boundaries = {
      appendix_start_block_id: "blk_structure_editor_state_appendix",
      body_start_block_id: nodes[1]?.block_id ?? "",
    };

    expect(buildStructurePreview(nodes, boundaries, "source")).toEqual([
      expect.objectContaining({ number: "P", role: "frontmatter" }),
      expect.objectContaining({ number: "Chapter 9", role: "body" }),
      expect.objectContaining({ number: "Section 42", role: "body" }),
      expect.objectContaining({ number: "Appendix A", role: "appendix" }),
    ]);
    expect(buildStructurePreview(nodes, boundaries, "generated")).toEqual([
      expect.objectContaining({ number: null, role: "frontmatter" }),
      expect.objectContaining({ number: "1", role: "body" }),
      expect.objectContaining({ number: "1.1", role: "body" }),
      expect.objectContaining({ number: null, role: "appendix" }),
    ]);
    expect(
      buildStructurePreview(nodes, boundaries, "none").every(
        (node) => node.number === null,
      ),
    ).toBe(true);
    expect(nodes[2]?.source_number).toBe("Section 42");
  });

  it("accepts the server numbering unless it changed again after submit", () => {
    expect(mergeAcceptedNumbering("generated", "generated", "generated")).toBe(
      "generated",
    );
    expect(mergeAcceptedNumbering("generated", "source", "none")).toBe("none");
  });

  it("keeps an unsaved numbering choice across an unrelated refresh", () => {
    expect(mergeAcceptedNumbering("source", "source", "none")).toBe("none");
  });

  it("keeps only edits made after the accepted save snapshot", () => {
    const submittedNode: EditableStructureNode = {
      block_id: "blk_structure_editor_state_0001",
      display_level: 1,
      exclude_from_numbering: false,
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
        exclude_from_numbering: false,
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
        exclude_from_numbering: false,
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
          exclude_from_numbering: false,
          include_in_toc: true,
          starts_page: true,
          title_markdown: "Appendix",
        },
        3,
      ),
    ).toEqual({
      block_id: "blk_structure_editor_state_0002",
      display_level: 3,
      exclude_from_numbering: false,
      include_in_toc: true,
      starts_page: true,
      title_markdown: "Appendix",
    });
  });
});
