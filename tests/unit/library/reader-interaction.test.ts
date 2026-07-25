import { describe, expect, it } from "vitest";

import { renderReaderShell } from "@/components/reader/render";
import { shouldNavigateWithArrowKey } from "@/components/reader/reader-interaction";

const props = {
  bodyHtml: '<h1 id="blk_test">Chapter</h1>',
  bookKey: "current-book",
  bookTitle: "Current Book",
  currentPageId: 1,
  nextHref: "/read/current-book/2",
  originalDownloads: [
    { href: "/books/current-book/originals/file_test", label: "Source" },
  ],
  outline: [{ href: "#blk_test", level: 1, title: "Chapter" }],
  pages: [
    { href: "/read/current-book/1", pageId: 1, title: "Chapter" },
    { href: "/read/current-book/2", pageId: 2, title: "Next" },
  ],
  previousHref: null,
} as const;

describe("reader interaction", () => {
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

  it("renders named mobile drawer controls and no-script navigation content", () => {
    const html = renderReaderShell(props);
    for (const label of ["目录", "本文", "搜索", "下载"]) {
      expect(html).toContain(`>${label}<`);
    }
    expect(html).toContain('aria-controls="reader-mobile-toc"');
    expect(html).toContain("<dialog");
    expect(html).toContain('aria-label="全书目录"');
    expect(html).toContain('aria-label="本页提纲"');
    expect(html).toContain('href="/library"');
  });

  it("initializes every bounded search instance independently", () => {
    const html = renderReaderShell(props);
    expect(html).toContain(
      'document.querySelectorAll("[data-book-search-container]")',
    );
    expect(html.match(/data-book-search/g)?.length).toBeGreaterThan(1);
    expect(html).toContain("container.dataset.searchInitialized");
  });
});
