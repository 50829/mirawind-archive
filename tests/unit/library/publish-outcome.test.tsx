import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PublishPanel } from "@/web/components/manage/PublishPanel";

const base = {
  bookId: 7,
  configRevision: 2,
  previewReady: true,
  previewStale: false,
} as const;

describe("synchronous candidate publication controls", () => {
  it("enables publication only for the ready candidate version", () => {
    const ready = renderToStaticMarkup(
      <PublishPanel
        {...base}
        candidateVersionId="ver_publish_outcome_test_0001"
      />,
    );
    expect(ready).toContain("发布当前修订");
    expect(ready).not.toMatch(/<button[^>]*\sdisabled(?:=|\s|>)/u);

    const building = renderToStaticMarkup(
      <PublishPanel {...base} candidateVersionId={null} previewReady={false} />,
    );
    expect(building).toMatch(/<button[^>]*\sdisabled(?:=|\s|>)/u);
    expect(building).toContain("预览完成并通过校验后才能发布");
  });

  it("keeps stale and blocking candidates disabled with persistent guidance", () => {
    const stale = renderToStaticMarkup(
      <PublishPanel
        {...base}
        candidateVersionId="ver_publish_outcome_test_0001"
        previewStale
      />,
    );
    expect(stale).toMatch(/<button[^>]*\sdisabled(?:=|\s|>)/u);
    expect(stale).toContain("当前预览已过期");

    const blocked = renderToStaticMarkup(
      <PublishPanel
        {...base}
        blocked
        candidateVersionId="ver_publish_outcome_test_0001"
      />,
    );
    expect(blocked).toMatch(/<button[^>]*\sdisabled(?:=|\s|>)/u);
  });
});
