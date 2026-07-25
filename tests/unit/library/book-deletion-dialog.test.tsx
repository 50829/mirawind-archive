import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BookDeletionDialog } from "@/components/library/AdminLibraryEnhancement";
import type { AdministratorLibraryEntry } from "@/services/library";

const book: AdministratorLibraryEntry = {
  bookId: 7,
  currentVersionAvailable: true,
  deletionMutationToken: `"${"a".repeat(43)}"`,
  previewReady: true,
  primaryHref: "/read/seven/1",
  statusLabel: "已发布",
  title: "Café",
  visibility: "public",
};

function markup(confirmationTitle: string): string {
  return renderToStaticMarkup(
    <BookDeletionDialog
      book={book}
      busy={false}
      confirmationTitle={confirmationTitle}
      error=""
      onCancel={() => undefined}
      onChange={() => undefined}
      onConfirm={() => undefined}
    />,
  );
}

describe("permanent book deletion dialog", () => {
  it("names the target, warning and exact-title input", () => {
    const html = markup("");
    expect(html).toContain("<dialog");
    expect(html).toContain('aria-labelledby="delete-book-title"');
    expect(html).toContain("永久删除《Café》");
    expect(html).toContain("不可撤销");
    expect(html).toContain("没有回收站");
    expect(html).toContain('id="delete-book-confirmation"');
    expect(html).toContain("永久删除，无法恢复");
    expect(html).toMatch(/disabled=""[^>]*>永久删除，无法恢复/u);
  });

  it("accepts canonically equivalent Unicode but not case changes", () => {
    expect(markup("Cafe\u0301")).not.toMatch(
      /disabled=""[^>]*>永久删除，无法恢复/u,
    );
    expect(markup("café")).toMatch(/disabled=""[^>]*>永久删除，无法恢复/u);
  });
});
