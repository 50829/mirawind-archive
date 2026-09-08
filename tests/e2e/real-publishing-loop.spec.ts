import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { verifyRealMineruFixtures } from "../../scripts/fixtures/verify-real-mineru";
import { loginAsAdministrator } from "../helpers/e2e-login.js";

const realFixtureDirectory = process.env.MIRAWIND_REAL_FIXTURE_DIR
  ? resolve(process.env.MIRAWIND_REAL_FIXTURE_DIR)
  : undefined;
const realFixtureId = "real-mineru-e80477ff22ac";

test("publishes the registered 97-page MinerU fixture through the browser loop", async ({
  page,
}) => {
  test.skip(
    !realFixtureDirectory,
    "The private real-fixture directory is not available.",
  );
  test.setTimeout(180_000);

  const fixtures = await verifyRealMineruFixtures(
    String(realFixtureDirectory),
    undefined,
    [realFixtureId],
  );
  const realFixtureName = fixtures[0]?.fileName;
  if (!realFixtureName) throw new Error("REAL_FIXTURE_MISSING");
  await loginAsAdministrator(page, "192.0.2.18");
  await page
    .getByLabel("MinerU ZIP")
    .setInputFiles(resolve(String(realFixtureDirectory), realFixtureName));
  await page.getByRole("button", { name: "上传并分析" }).click();
  await expect(page.getByRole("link", { name: "打开出版工作台" })).toBeVisible({
    timeout: 60_000,
  });

  const workbenchHref = await page
    .getByRole("link", { name: "打开出版工作台" })
    .getAttribute("href");
  expect(workbenchHref).toMatch(/^\/manage\/books\/[1-9][0-9]*$/u);
  await page.goto(String(workbenchHref));
  await expect(page.locator("iframe")).toHaveAttribute(
    "sandbox",
    "allow-scripts",
  );
  await expect(page.getByRole("button", { name: "发布当前预览" })).toBeEnabled({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "发布当前预览" }).click();
  const startReading = page.getByRole("link", { name: "开始阅读" });
  await expect(startReading).toBeVisible({ timeout: 90_000 });
  await startReading.click();

  await expect(page.getByRole("main")).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "全书目录" }),
  ).toBeVisible();
  await expect(page.locator(".reader-document")).not.toBeEmpty();
});
