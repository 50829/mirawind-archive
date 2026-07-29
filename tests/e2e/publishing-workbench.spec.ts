import { expect, test } from "@playwright/test";

import { loginAsAdministrator } from "../helpers/e2e-login.js";

function draftProjection(
  size: number,
  diagnosticSeverity: "error" | "warning" = "warning",
) {
  const structure = Array.from({ length: size }, (_, index) => ({
    block_id: `blk_workbench_${String(index).padStart(16, "0")}`,
    display_level: (index % 4) + 1,
    display_title: `Structure item ${index + 1}`,
    include_in_toc: true,
    ...(index % 4 === 0 ? { role: "body" as const } : {}),
    starts_page: index === 0,
  }));
  return {
    book_id: 99,
    config_revision: 1,
    diagnostics: [
      {
        blockId: structure[0]?.block_id,
        code: "WORKBENCH_TEST_DIAGNOSTIC",
        location: {
          blockId: structure[0]?.block_id,
          endByte: 40,
          regionId: "region_workbench_0001",
          startByte: 20,
        },
        message: "Locatable test diagnostic",
        recovery: ["select_structure", "reload", "reprocess_verbatim"],
        severity: diagnosticSeverity,
      },
    ],
    preview: {
      compiler_version: "compiler-v4",
      config_revision: 1,
      config_sha256: "a".repeat(64),
      headings: structure.map((node, index) => ({
        ...node,
        page_id: 1,
        source_level: node.display_level,
        source_title: `Source item ${index + 1}`,
        title: node.display_title,
      })),
      is_stale: false,
      pages: [{ page_id: 1, title: "Preview page" }],
      renderer_version: "semantic-html-v4-katex-0.18.1",
      semantic_digest: "b".repeat(64),
      source_regions: [],
      source_sha256: "c".repeat(64),
      typography: {
        profile: "zh-smart-v1",
        protected_nodes: 3,
        punctuation_converted: 2,
        spaces_normalized: 1,
      },
    },
    preview_state: "ready",
    regions: [
      {
        applied: true,
        block_id: structure[0]?.block_id,
        entry_count: 6,
        region_id: "region_workbench_0001",
      },
    ],
    structure,
    title: `Workbench ${size}`,
  };
}

test("blocks publication only for error diagnostics", async ({ page }) => {
  let diagnosticSeverity: "error" | "warning" = "warning";
  await page.route("**/api/manage/books/99/draft", (route) =>
    route.fulfill({
      body: JSON.stringify(draftProjection(20, diagnosticSeverity)),
      contentType: "application/json",
      headers: { ETag: `"${"a".repeat(43)}"` },
      status: 200,
    }),
  );
  await page.route("**/api/manage/books/99/preview/**", (route) =>
    route.fulfill({
      body: "<!doctype html><html lang='en'><body>Preview</body></html>",
      contentType: "text/html",
      status: 200,
    }),
  );
  await loginAsAdministrator(page, "192.0.2.17");
  await page.goto("/manage/books/99/preview");

  const publish = page.getByRole("button", { name: "发布当前修订" });
  await expect(publish).toBeEnabled();

  diagnosticSeverity = "error";
  await page.reload();
  await expect(publish).toBeDisabled();
});

test("keeps representative and stress structure DOM bounded", async ({
  page,
}) => {
  let size = 20;
  await page.route("**/api/manage/books/99/draft", (route) =>
    route.fulfill({
      body: JSON.stringify(draftProjection(size)),
      contentType: "application/json",
      headers: { ETag: `"${"a".repeat(43)}"` },
      status: 200,
    }),
  );
  await page.route("**/api/manage/books/99/preview/**", (route) =>
    route.fulfill({
      body: "<!doctype html><html lang='en'><body>Preview</body></html>",
      contentType: "text/html",
      status: 200,
    }),
  );
  await loginAsAdministrator(page, "192.0.2.14");

  for (const representativeSize of [20, 250, 501, 2_000]) {
    size = representativeSize;
    await page.goto(`/manage/books/99/preview?size=${size}`);
    await expect(
      page.getByRole("heading", { name: `Workbench ${size}` }),
    ).toBeVisible();
    const renderedRows = page.locator(".structure-tree > li");
    await expect(renderedRows.first()).toBeVisible();
    expect(await renderedRows.count()).toBeLessThanOrEqual(30);

    const search = page.getByRole("searchbox", { name: "搜索结构" });
    if (representativeSize === 20) {
      const firstChild = page
        .locator(".structure-tree")
        .getByRole("button", { name: "Structure item 2", exact: true });
      await expect(firstChild).toBeVisible();
      await page.getByRole("button", { name: "折叠子项" }).first().click();
      await expect(firstChild).toBeHidden();
      await search.fill("Structure item 2");
      await expect(firstChild).toBeVisible();
      await search.fill("");
      await page.getByRole("button", { name: "展开子项" }).first().click();
      await expect(firstChild).toBeVisible();
    }
    await search.fill(`Structure item ${size}`);
    await expect(
      page
        .locator(".structure-tree")
        .getByRole("button", { name: `Structure item ${size}`, exact: true }),
    ).toBeVisible();
  }

  size = 20_000;
  await page.goto(`/manage/books/99/preview?size=${size}`);
  await expect(
    page.getByRole("heading", { name: `Workbench ${size}` }),
  ).toBeVisible();
  const stressRows = page.locator(".structure-tree > li");
  await expect(stressRows.first()).toBeVisible();
  expect(await stressRows.count()).toBeLessThanOrEqual(30);
  await page.goto("/manage");
  await expect(page.getByRole("heading", { name: "准备一本书" })).toBeVisible();
});

test("locates diagnostics and preserves dirty edits during recovery", async ({
  page,
}) => {
  let draftRequests = 0;
  await page.route("**/api/manage/books/99/draft", (route) => {
    draftRequests += 1;
    return route.fulfill({
      body: JSON.stringify(draftProjection(20)),
      contentType: "application/json",
      headers: { ETag: `"${"a".repeat(43)}"` },
      status: 200,
    });
  });
  await page.route("**/api/manage/books/99/preview/**", (route) =>
    route.fulfill({
      body: "<!doctype html><html lang='en'><body>Preview</body></html>",
      contentType: "text/html",
      status: 200,
    }),
  );
  await loginAsAdministrator(page, "192.0.2.16");
  await page.goto("/manage/books/99/preview");

  await page.getByRole("button", { name: "定位" }).click();
  await expect(
    page.locator(".structure-tree [aria-current=true]"),
  ).toContainText("Structure item 1");
  await expect(page.locator("iframe")).toHaveAttribute(
    "src",
    /#blk_workbench_0000000000000000$/u,
  );

  const title = page.getByRole("textbox", { name: "显示标题" });
  await title.fill("Unsaved local title");
  await page.getByRole("button", { name: "重新载入" }).click();
  await expect.poll(() => draftRequests).toBeGreaterThan(1);
  await expect(title).toHaveValue("Unsaved local title");
  await expect(
    page.getByRole("button", { name: "按原文重新处理" }),
  ).toBeDisabled();
});

test("restores focus after each mobile workbench detail dialog", async ({
  page,
}) => {
  await page.setViewportSize({ height: 800, width: 390 });
  await page.route("**/api/manage/books/99/draft", (route) =>
    route.fulfill({
      body: JSON.stringify(draftProjection(20)),
      contentType: "application/json",
      headers: { ETag: `"${"a".repeat(43)}"` },
      status: 200,
    }),
  );
  await page.route("**/api/manage/books/99/preview/**", (route) =>
    route.fulfill({
      body: "<!doctype html><html lang='en'><body>Preview</body></html>",
      contentType: "text/html",
      status: 200,
    }),
  );
  await loginAsAdministrator(page, "192.0.2.15");
  await page.goto("/manage/books/99/preview");
  await page.getByRole("button", { name: "结构", exact: true }).click();

  const currentItem = page.getByRole("button", { name: "当前项" });
  await currentItem.click();
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "当前结构项" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭当前项编辑" }).click();
  await expect(currentItem).toBeFocused();

  const sourceHandling = page.getByRole("button", {
    name: "源处理",
    exact: true,
  });
  await sourceHandling.click();
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "源处理" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭源处理" }).click();
  await expect(sourceHandling).toBeFocused();

  const diagnostics = page.getByRole("button", { name: "1 个问题" });
  await diagnostics.click();
  await expect(
    page.getByRole("dialog").getByText("WORKBENCH_TEST_DIAGNOSTIC"),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭问题列表" }).click();
  await expect(diagnostics).toBeFocused();
});
