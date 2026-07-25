import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BookCard } from "@/components/library/BookCard";
import { LibraryScene } from "@/components/library/LibraryScene";
import type { PublicLibraryEntry } from "@/services/library";

const entry: PublicLibraryEntry = {
  authors: ["Ursula Writer"],
  bookId: 7,
  bookKey: "earthsea",
  coverUrl: null,
  detailsUrl: "/books/earthsea",
  presentationDigest: "a".repeat(64),
  startUrl: "/read/earthsea/1",
  title: "Earthsea",
  versionId: "ver_component_fixture_0001",
};

describe("library components", () => {
  it("renders each card as a semantic article with ordinary actions", () => {
    const html = renderToStaticMarkup(<BookCard entry={entry} />);
    expect(html).toContain("<article");
    expect(html).toContain("<h2");
    expect(html).toContain('href="/read/earthsea/1"');
    expect(html).toContain('href="/books/earthsea"');
    expect(html).toContain("Ursula Writer");
    expect(html).toContain("Earthsea");
  });

  it("uses a stable title placeholder without a broken image", () => {
    const html = renderToStaticMarkup(<BookCard entry={entry} />);
    expect(html).not.toContain("<img");
    expect(html).toContain('aria-hidden="true"');
  });

  it("renders useful empty and partial-unavailable states", () => {
    const empty = renderToStaticMarkup(
      <LibraryScene
        library={{
          digest: "empty",
          entries: [],
          hasUnavailableBooks: false,
        }}
      />,
    );
    expect(empty).toContain("书库还是空的");
    const partial = renderToStaticMarkup(
      <LibraryScene
        library={{
          digest: "partial",
          entries: [entry],
          hasUnavailableBooks: true,
        }}
      />,
    );
    expect(partial).toContain("部分图书暂时无法显示");
    expect(partial).not.toMatch(/省略|隐藏|1 本/u);
  });
});
