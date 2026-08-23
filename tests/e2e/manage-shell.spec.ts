import { expect, test } from "@playwright/test";

import { loginAsAdministrator } from "../helpers/e2e-login.js";

test("shares one responsive management hierarchy and retains library enhancement", async ({
  page,
}) => {
  await loginAsAdministrator(page, "192.0.2.19");
  await page.setViewportSize({ height: 800, width: 360 });
  const library = await page.request.get("/api/manage/library?limit=1");
  const libraryBody = (await library.json()) as {
    readonly entries: readonly {
      readonly book_id: number;
      readonly reading_href: string | null;
      readonly status_label: string;
      readonly title: string;
    }[];
  };
  const entry = libraryBody.entries.at(0);
  const bookId = entry?.book_id;
  expect(bookId).toBeTruthy();

  const routes = [
    { currentHref: "/manage", path: "/manage" },
    { currentHref: "/manage/tasks", path: "/manage/tasks" },
    { currentHref: "/manage/security", path: "/manage/security" },
    { currentHref: "/library", path: `/manage/books/${bookId}` },
  ] as const;
  for (const route of routes) {
    const response = await page.goto(route.path);
    expect(response?.status()).toBe(200);
    const navigation = page.getByRole("navigation", { name: "管理导航" });
    await expect(navigation.getByRole("link")).toHaveCount(4);
    await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(navigation.locator('[aria-current="page"]')).toHaveAttribute(
      "href",
      route.currentHref,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.goto("/manage/tasks");
  await expect(page.getByRole("heading", { name: "最近完成" })).toBeVisible();
  expect(await page.locator(".task-card").count()).toBeLessThanOrEqual(8);
  expect((await page.goto("/manage/books/999999999"))?.status()).toBe(404);

  const capability = await page.request.get(
    "/api/library/management-capability",
  );
  expect(capability.status()).toBe(200);
  expect(capability.headers()["cache-control"]).toBe("private, no-store");
  expect(await capability.json()).toEqual({ management_available: true });

  await page.goto("/library");
  await expect(
    page.getByRole("heading", { name: "管理中的图书" }),
  ).toBeVisible();
  const row = page
    .locator(".admin-library li")
    .filter({ has: page.locator(`a[href="/manage/books/${bookId}"]`) })
    .first();
  await expect(row).toBeVisible();
  await expect(row.locator(":scope > a")).toHaveAttribute(
    "href",
    `/manage/books/${bookId}`,
  );
  await expect(row.getByRole("link", { name: "管理" })).toHaveAttribute(
    "href",
    `/manage/books/${bookId}`,
  );
  if (entry?.reading_href) {
    await expect(row.getByRole("link", { name: "阅读" })).toHaveAttribute(
      "href",
      entry.reading_href,
    );
  }
  await expect(row.locator(":scope > span")).toHaveText(
    entry?.status_label ?? "",
  );
  await expect(
    row.getByRole("button", { name: `永久删除《${entry?.title ?? ""}》` }),
  ).toBeVisible();
  expect(
    await row.evaluate((element) => getComputedStyle(element).display),
  ).toBe("grid");
});
