import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { loginAsAdministrator } from "../helpers/e2e-login.js";

const realFixtureDirectory = process.env.MIRAWIND_REAL_FIXTURE_DIR;
const realFixtureName = "real-mineru-e80477ff22ac.zip";

test("publishes the registered 97-page MinerU fixture through the browser loop", async ({
  page,
}) => {
  test.skip(
    !realFixtureDirectory,
    "The private real-fixture directory is not available.",
  );
  test.setTimeout(180_000);

  await loginAsAdministrator(page, "192.0.2.18");
  await page
    .getByLabel("MinerU ZIP")
    .setInputFiles(resolve(String(realFixtureDirectory), realFixtureName));
  await expect(page.getByText(realFixtureName, { exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "上传并分析" }).click();
  await expect(page.getByRole("link", { name: "打开出版工作台" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText(realFixtureName, { exact: true })).toBeVisible();
  await expect(page.getByLabel("后台处理进度 100%")).toBeVisible();

  const workbenchHref = await page
    .getByRole("link", { name: "打开出版工作台" })
    .getAttribute("href");
  expect(workbenchHref).toMatch(/^\/manage\/books\/[1-9][0-9]*$/u);
  await page.goto(String(workbenchHref));
  const bookTitle = (
    await page.locator(".workbench-title h1").textContent()
  )?.trim();
  expect(bookTitle).toBeTruthy();
  expect(bookTitle).not.toMatch(/^job_/u);

  await page.goto("/manage/tasks");
  const bookTasks = page.locator(".task-card").filter({
    has: page.getByText(String(bookTitle), { exact: true }),
  });
  await expect(bookTasks).toHaveCount(3);
  await expect(bookTasks.getByLabel("任务进度 100%")).toHaveCount(3);
  await expect(bookTasks.locator("code:visible")).toHaveCount(0);

  await page.goto(String(workbenchHref));
  await expect(page.locator("iframe")).toHaveAttribute(
    "sandbox",
    "allow-scripts",
  );
  await expect(page.getByRole("button", { name: "发布当前修订" })).toBeEnabled({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "发布当前修订" }).click();
  const startReading = page.getByRole("link", { name: "开始阅读" });
  await expect(startReading).toBeVisible({ timeout: 90_000 });
  await startReading.click();

  await expect(page.getByRole("main")).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "全书目录" }),
  ).toBeVisible();
  await expect(page.locator(".reader-document")).not.toBeEmpty();
});
