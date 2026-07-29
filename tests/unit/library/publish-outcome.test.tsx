import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PublishPanel } from "@/web/components/manage/PublishPanel";
import { publicationPhaseLabel } from "@/web/components/manage/publication-phase";

const base = {
  bookId: 7,
  configRevision: 2,
  previewReady: true,
  previewStale: false,
} as const;

describe("publication outcome", () => {
  it("maps internal phases to reader-facing labels", () => {
    expect(publicationPhaseLabel("queued")).toBe("等待后台处理");
    expect(publicationPhaseLabel("starting")).toBe("准备发布环境");
    expect(publicationPhaseLabel("complete")).toBe("完成原子切换");
    expect(publicationPhaseLabel("unknown_internal_phase")).toBe("正在构建");
  });

  it("silently replaces a committed success with canonical actions", () => {
    const queued = renderToStaticMarkup(
      <PublishPanel
        {...base}
        initialJob={{
          error_code: null,
          job_id: "job_publish_outcome_test_0001",
          phase: "starting",
          publication: null,
          state: "running",
        }}
      />,
    );
    expect(queued).not.toContain("查看图书");
    expect(queued).not.toContain("/books/");

    const succeeded = renderToStaticMarkup(
      <PublishPanel
        {...base}
        initialJob={{
          error_code: null,
          job_id: "job_publish_outcome_test_0001",
          phase: "complete",
          publication: {
            book_id: 7,
            book_key: "published-book",
            details_url: "/books/published-book",
            library_url: "/library",
            start_url: "/read/published-book/1",
            version_id: "ver_publish_outcome_test_0001",
          },
          state: "succeeded",
        }}
      />,
    );
    expect(succeeded).not.toContain("发布完成");
    expect(succeeded).toContain('href="/books/published-book"');
    expect(succeeded).toContain('href="/read/published-book/1"');
    expect(succeeded).toContain('href="/library"');
  });

  it("keeps terminal failure guidance free of speculative live links", () => {
    const html = renderToStaticMarkup(
      <PublishPanel
        {...base}
        initialJob={{
          error_code: "PUBLICATION_STALE",
          job_id: "job_publish_outcome_test_0001",
          phase: "failed",
          publication: null,
          state: "failed",
        }}
      />,
    );
    expect(html).toContain("上一已发布版本");
    expect(html).toContain("查看后台任务");
    expect(html).not.toContain("查看图书");
    expect(html).not.toContain("开始阅读");
  });
});
