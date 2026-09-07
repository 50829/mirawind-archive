import { describe, expect, it } from "vitest";

import {
  buildReaderNavigationTree,
  readerBreadcrumbs,
} from "@/modules/reader/application/reader-api";
import { shouldNavigateWithArrowKey } from "@/web/features/reader/reader-interaction";

const props = {
  bodyHtml: '<h1 id="blk_test">Chapter</h1>',
  bookKey: "current-book",
  bookTitle: "Current Book",
  currentTocHeadingId: "blk_test",
  currentPageId: 1,
  firstPageHref: "/read/current-book/1",
  nextHref: "/read/current-book/2",
  originalDownloads: [
    { href: "/books/current-book/originals/file_test", label: "Source" },
  ],
  outline: [
    {
      blockId: "blk_test",
      href: "#blk_test",
      level: 1,
      title: "1. Chapter",
    },
  ],
  pageOwnerHeadingId: "blk_test",
  toc: [
    {
      blockId: "blk_test",
      href: "/read/current-book/1#blk_test",
      level: 1,
      pageId: 1,
      title: "1. Chapter",
    },
    {
      blockId: "blk_model",
      href: "/read/current-book/1#blk_model",
      level: 2,
      pageId: 1,
      title: "1.1. Model",
    },
    {
      blockId: "blk_next",
      href: "/read/current-book/2#blk_next",
      level: 1,
      pageId: 2,
      title: "2. Next",
    },
  ],
  previousHref: null,
} as const;

describe("reader interaction", () => {
  it("builds nested navigation and the exact current ancestor path", () => {
    const tree = buildReaderNavigationTree(props.toc);
    expect(tree).toMatchObject([
      {
        blockId: "blk_test",
        children: [{ blockId: "blk_model", children: [] }],
      },
      { blockId: "blk_next", children: [] },
    ]);
    expect(readerBreadcrumbs(props.toc, "blk_model")).toEqual([
      expect.objectContaining({ blockId: "blk_test" }),
      expect.objectContaining({ blockId: "blk_model" }),
    ]);
  });

  it("excludes editable, code, link, role-bearing and dialog contexts", () => {
    const base = {
      altKey: false,
      ctrlKey: false,
      defaultPrevented: false,
      isComposing: false,
      key: "ArrowRight",
      metaKey: false,
      shiftKey: false,
    } as const;
    expect(
      shouldNavigateWithArrowKey({
        dialogOpen: false,
        event: base,
        path: [{ tagName: "P" }],
      }),
    ).toBe(true);
    for (const path of [
      [{ tagName: "INPUT" }],
      [{ tagName: "CODE" }],
      [{ tagName: "A" }],
      [{ role: "button", tagName: "SPAN" }],
      [{ contentEditable: "true", tagName: "DIV" }],
      [{ tabIndex: 0, tagName: "DIV" }],
      [{ interactive: true, tagName: "DIV" }],
    ]) {
      expect(
        shouldNavigateWithArrowKey({
          dialogOpen: false,
          event: base,
          path,
        }),
      ).toBe(false);
    }
    expect(
      shouldNavigateWithArrowKey({
        dialogOpen: true,
        event: base,
        path: [{ tagName: "P" }],
      }),
    ).toBe(false);
  });
});
