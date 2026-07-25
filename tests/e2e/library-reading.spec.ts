import { expect, test } from "@playwright/test";
import axe from "axe-core";

const axeSource = axe.source;

async function expectNoSeriousAccessibilityFindings(
  page: import("@playwright/test").Page,
) {
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => {
    const axe = (
      window as typeof window & {
        axe: {
          run: (
            context?: Document,
            options?: Readonly<Record<string, unknown>>,
          ) => Promise<{
            violations: readonly {
              impact: string | null;
              id: string;
            }[];
          }>;
        };
      }
    ).axe;
    const result = await axe.run(document, {
      resultTypes: ["violations"],
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
    });
    return result.violations
      .filter(
        (violation) =>
          violation.impact === "critical" || violation.impact === "serious",
      )
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact,
      }));
  });
  expect(violations).toEqual([]);
}

test("discovers details, restores context and completes the reader loop", async ({
  page,
}, testInfo) => {
  const javascriptEnabled = testInfo.project.name !== "library-no-javascript";
  const mobile = testInfo.project.name === "library-mobile";
  if (javascriptEnabled) {
    await page.addInitScript(() => {
      window.addEventListener("DOMContentLoaded", () => {
        document.body.style.minHeight = "2400px";
      });
    });
  }
  const response = await page.goto("/library");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["cache-control"]).toBe(
    "public, max-age=0, must-revalidate",
  );
  await expect(
    page.getByRole("heading", { name: "E2E Library Book" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "开始阅读《E2E Library Book》" }),
  ).toHaveAttribute("href", "/read/e2e-library-book/1");
  if (javascriptEnabled) await expectNoSeriousAccessibilityFindings(page);

  const detailsLink = page
    .locator(".library-card")
    .filter({ hasText: "E2E Library Book" })
    .getByRole("link", { name: "查看详情" });
  if (javascriptEnabled) {
    await page.evaluate(() => {
      window.scrollTo(0, 900);
    });
  }
  await detailsLink.click();
  await expect(page).toHaveURL(/\/books\/e2e-library-book$/u);
  const storedScrollY = javascriptEnabled
    ? await page.evaluate(() => {
        const raw = sessionStorage.getItem("mirawind.library-context.v1");
        return raw
          ? Number(
              (JSON.parse(raw) as Readonly<Record<string, unknown>>).scrollY,
            )
          : -1;
      })
    : 0;
  const dialog = page.getByRole("dialog", { name: "E2E Library Book" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link", { name: "开始阅读" })).toHaveAttribute(
    "href",
    "/read/e2e-library-book/1",
  );
  await expect(dialog.getByRole("heading", { name: "目录" })).toBeVisible();
  if (javascriptEnabled) await expectNoSeriousAccessibilityFindings(page);

  await dialog.getByRole("link", { name: "关闭图书详情" }).click();
  await expect(page).toHaveURL(/\/library$/u);
  if (javascriptEnabled) {
    await expect
      .poll(async () =>
        Math.abs((await page.evaluate(() => window.scrollY)) - storedScrollY),
      )
      .toBeLessThan(2);
    await expect(detailsLink).toBeFocused();

    await detailsLink.click();
    await expect(page).toHaveURL(/\/books\/e2e-library-book$/u);
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/library$/u);
    await expect(detailsLink).toBeFocused();

    await detailsLink.click();
    await expect(page).toHaveURL(/\/books\/e2e-library-book$/u);
    await page.goBack();
    await expect(page).toHaveURL(/\/library$/u);
    await expect(detailsLink).toBeFocused();
  }

  await page.goto("/books/e2e-library-book");
  await page.getByRole("link", { name: "关闭图书详情" }).click();
  await expect(page).toHaveURL(/\/library$/u);

  await page.goto("/read/e2e-library-book/1");
  await expect(page.getByRole("link", { name: "返回书库" })).toBeVisible();
  const breadcrumb = page.getByRole("navigation", { name: "当前位置" });
  await expect(breadcrumb).toContainText("Opening");
  if (mobile) {
    await expect(page.getByRole("button", { name: "目录" })).toBeVisible();
  } else {
    const toc = page.getByRole("navigation", { name: "全书目录" }).first();
    await expect(toc).toBeVisible();
    const currentBranch = toc.locator("details").first();
    await expect(currentBranch).toHaveAttribute("open", "");
    await expect(
      toc.getByRole("link", { name: "1.1. Overview" }),
    ).toHaveAttribute(
      "href",
      "/read/e2e-library-book/1#blk_e2e_library_overview_0001",
    );
    if (javascriptEnabled) {
      const toggle = currentBranch.locator("summary");
      await toggle.click();
      await expect(currentBranch).not.toHaveAttribute("open", "");
      await toggle.click();
      await expect(currentBranch).toHaveAttribute("open", "");

      const outline = page
        .getByRole("navigation", { name: "本页提纲" })
        .first();
      const overviewOutline = outline.getByRole("link", {
        name: "1.1. Overview",
      });
      await page
        .locator("#blk_e2e_library_overview_0001")
        .evaluate((element) => element.scrollIntoView({ block: "start" }));
      await expect(overviewOutline).toHaveAttribute("aria-current", "location");
    }
  }
  await expect(page.getByRole("main")).toContainText("A seeded public book");
  if (javascriptEnabled) {
    await expectNoSeriousAccessibilityFindings(page);
    if (mobile) {
      const tocTrigger = page.getByRole("button", { name: "目录" });
      await tocTrigger.click();
      const tocDialog = page.getByRole("dialog", { name: "目录" });
      await expect(tocDialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(tocDialog).toBeHidden();
      await expect(tocTrigger).toBeFocused();

      for (const label of ["本文", "下载"] as const) {
        const trigger = page.getByRole("button", { name: label });
        await trigger.click();
        const drawer = page.getByRole("dialog", { name: label });
        await expect(drawer).toBeVisible();
        await drawer.getByRole("button", { name: "关闭" }).click();
        await expect(drawer).toBeHidden();
        await expect(trigger).toBeFocused();
      }

      await page.getByRole("button", { name: "搜索" }).click();
      const searchDialog = page.getByRole("dialog", { name: "搜索" });
      await searchDialog.getByRole("searchbox").fill("Searchable");
      await searchDialog.getByRole("button", { name: "搜索" }).click();
      const results = searchDialog.locator("[data-search-results]");
      await expect(results).toContainText("E2E Library Book");
      await results.getByRole("link").first().click();
    } else {
      const search = page.getByRole("region", { name: "书内搜索" }).first();
      await search.getByRole("searchbox").fill("Searchable");
      await search.getByRole("button", { name: "搜索" }).click();
      const results = search.locator("[data-search-results]");
      await expect(results).toContainText("E2E Library Book");
      await results.getByRole("link").first().click();
    }
    await expect(page).toHaveURL(
      /\/read\/e2e-library-book\/2#[A-Za-z0-9_-]+$/u,
    );
    await page.locator("a[rel='prev']").click();
    await expect(page).toHaveURL(/\/read\/e2e-library-book\/1$/u);
    await page.locator("main").click({ position: { x: 10, y: 10 } });
    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(/\/read\/e2e-library-book\/2$/u);
  } else {
    await page.locator("a[rel='next']").click();
    await expect(page).toHaveURL(/\/read\/e2e-library-book\/2$/u);
    await page.locator("a[rel='prev']").click();
    await expect(page).toHaveURL(/\/read\/e2e-library-book\/1$/u);
  }
  await page.getByRole("link", { name: "返回书库" }).click();
  await expect(page).toHaveURL(/\/library$/u);
});

test("keeps hidden and unavailable identities out of public discovery", async ({
  page,
}) => {
  await page.goto("/library");
  await expect(page.getByText("Pending import")).toHaveCount(0);
  const missing = await page.request.get("/api/books/not-a-book/details");
  expect(missing.status()).toBe(404);
  expect(missing.headers()["cache-control"]).toBe("no-store");
  expect(missing.headers()["x-robots-tag"]).toContain("noindex");
});
