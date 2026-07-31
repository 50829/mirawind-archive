import { expect, test } from "@playwright/test";

import { loginAsAdministrator } from "../helpers/e2e-login.js";

test("shares one responsive management hierarchy and retains library enhancement", async ({
  page,
}) => {
  await loginAsAdministrator(page, "192.0.2.19");
  await page.setViewportSize({ height: 800, width: 360 });

  const routes = [
    { currentHref: "/manage", path: "/manage" },
    { currentHref: "/manage/tasks", path: "/manage/tasks" },
    { currentHref: "/manage/security", path: "/manage/security" },
    { currentHref: "/manage", path: "/manage/books/99/preview" },
  ] as const;
  for (const route of routes) {
    const response = await page.goto(route.path);
    expect(response?.status()).toBe(200);
    const navigation = page.getByRole("navigation", { name: "管理导航" });
    await expect(navigation.getByRole("link")).toHaveCount(3);
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
});
