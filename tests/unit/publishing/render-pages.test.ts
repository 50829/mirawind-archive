import { required } from "../../helpers/required";
import { describe, expect, it, vi } from "vitest";
import { compileBook } from "@/modules/publishing/core/publication/compile-book";
import { renderPages } from "@/modules/publishing/core/publication/render-pages";
import { smallBook, headingBlock, paragraphBlock } from "../../helpers/ir-book";
function fixture() {
  const book = smallBook();
  book.blocks = Array.from({ length: 6 }, (_, i) => [
    headingBlock(`Chapter ${i + 1}`),
    paragraphBlock(`Body ${i + 1}.`),
  ]).flat();
  book.publishing.boundaries = {
    body_start_block_id: required(book.blocks[0]).id,
  };
  return compileBook(book);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
describe("bounded ordered page rendering", () => {
  it("runs at most four pages and yields deterministic ordinal order", async () => {
    const book = fixture();
    const pending = new Map<
      number,
      ReturnType<
        typeof deferred<{
          readonly css: string;
          readonly diagnostics: readonly {
            readonly code: string;
            readonly message: string;
          }[];
          readonly html: string;
        }>
      >
    >();
    const started: number[] = [];
    let active = 0;
    let maximumActive = 0;
    const iterator = renderPages({
      book,
      renderPage: async ({ page }) => {
        started.push(page.pageId);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        const pageResult = deferred<{
          readonly css: string;
          readonly diagnostics: readonly {
            readonly code: string;
            readonly message: string;
          }[];
          readonly html: string;
        }>();
        pending.set(page.pageId, pageResult);
        const result = await pageResult.promise;
        active -= 1;
        return result;
      },
      resourceResolution: { diagnostics: [], references: [], resources: [] },
    })[Symbol.asyncIterator]();
    const firstResult = iterator.next();
    await vi.waitFor(() => expect(started).toEqual([1, 2, 3, 4]));
    for (const pageId of [4, 3, 2]) {
      pending.get(pageId)?.resolve({
        css: `.page-${pageId}{}`,
        diagnostics: [{ code: `PAGE_${pageId}`, message: "diagnostic" }],
        html: `<p>${pageId}</p>`,
      });
    }
    await Promise.resolve();
    expect(started).toEqual([1, 2, 3, 4]);
    pending.get(1)?.resolve({
      css: ".page-1{}",
      diagnostics: [{ code: "PAGE_1", message: "diagnostic" }],
      html: "<p>1</p>",
    });
    expect((await firstResult).value?.page.pageId).toBe(1);
    const results = [];
    for (;;) {
      const nextResult = iterator.next();
      await vi.waitFor(() => {
        const nextPending = [...pending.entries()].find(
          ([pageId, value]) => pageId >= 5 && value,
        );
        expect(nextPending ?? started.length === 6).toBeTruthy();
      });
      for (const pageId of [5, 6]) {
        pending.get(pageId)?.resolve({
          css: `.page-${pageId}{}`,
          diagnostics: [{ code: `PAGE_${pageId}`, message: "diagnostic" }],
          html: `<p>${pageId}</p>`,
        });
      }
      const result = await nextResult;
      if (result.done) break;
      results.push(result.value);
    }
    expect([1, ...results.map((result) => result.page.pageId)]).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(maximumActive).toBe(4);
    expect(results.map((result) => result.diagnostics[0]?.code)).toEqual([
      "PAGE_2",
      "PAGE_3",
      "PAGE_4",
      "PAGE_5",
      "PAGE_6",
    ]);
  });
  it("rejects before starting work when cancellation is requested", async () => {
    const controller = new AbortController();
    controller.abort();
    const renderPage = vi.fn();
    const iterator = renderPages({
      book: fixture(),
      renderPage,
      resourceResolution: { diagnostics: [], references: [], resources: [] },
      signal: controller.signal,
    })[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toMatchObject({ name: "AbortError" });
    expect(renderPage).not.toHaveBeenCalled();
  });
});
