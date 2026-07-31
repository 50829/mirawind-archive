import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PublishPanel } from "@/web/components/manage/PublishPanel";

const base = {
  bookId: 7,
  candidatePublished: false,
  etag: '"draft-etag"',
  onPublished: async () => undefined,
  previewReady: true,
  previewStale: false,
} as const;

describe("synchronous candidate publication controls", () => {
  it("enables publication only for the ready candidate version", () => {
    const ready = renderToStaticMarkup(<PublishPanel {...base} />);
    expect(ready).toContain("发布当前修订");
    expect(ready).not.toMatch(/<button[^>]*\sdisabled(?:=|\s|>)/u);

    const building = renderToStaticMarkup(
      <PublishPanel {...base} previewReady={false} />,
    );
    expect(building).toMatch(/<button[^>]*\sdisabled(?:=|\s|>)/u);
    expect(building).toContain("预览完成并通过校验后才能发布");
  });

  it("keeps stale and blocking candidates disabled with persistent guidance", () => {
    const stale = renderToStaticMarkup(<PublishPanel {...base} previewStale />);
    expect(stale).toMatch(/<button[^>]*\sdisabled(?:=|\s|>)/u);
    expect(stale).toContain("当前预览已过期");

    const blocked = renderToStaticMarkup(<PublishPanel {...base} blocked />);
    expect(blocked).toMatch(/<button[^>]*\sdisabled(?:=|\s|>)/u);
  });

  it("disables publication only after the current candidate is published", () => {
    const published = renderToStaticMarkup(
      <PublishPanel {...base} candidatePublished />,
    );
    expect(published).toContain("已发布");
    expect(published).toMatch(/<button[^>]*\sdisabled(?:=|\s|>)/u);
  });
});
