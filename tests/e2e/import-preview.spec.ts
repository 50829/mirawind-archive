import { stat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";

import {
  e2eAdministrator,
  e2eDataRoot,
  e2eFixtureRoot,
  e2eHighMarkdown,
} from "../helpers/global-setup.js";

async function upload(page: import("@playwright/test").Page, filename: string) {
  await page
    .getByLabel("MinerU ZIP")
    .setInputFiles(resolve(e2eFixtureRoot, filename));
  await page.getByRole("button", { name: "上传并分析" }).click();
}

test("imports high-confidence and generic books, rejects ambiguity, and preserves the source snapshot", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByText("使用备用密码", { exact: true }).click();
  await page.getByLabel("管理员邮箱").fill(e2eAdministrator.email);
  await page.getByLabel("备用密码").fill(e2eAdministrator.password);
  await page.getByRole("button", { name: "使用备用密码登录" }).click();
  await expect(page).toHaveURL(/\/manage$/u);

  await upload(page, "high-confidence.zip");
  await expect(page.getByText(/draft_ready/u)).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("link", { name: "打开结构预览" }).click();
  await expect(page.getByText("预览已就绪")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("heading", { name: "目录提议" })).toBeVisible();
  await expect(page.locator("iframe")).toBeVisible();
  await expect(
    page.frameLocator("iframe").getByText("A durable source paragraph."),
  ).toBeVisible();

  const database = new Database(resolve(e2eDataRoot, "db", "mirawind.sqlite"), {
    readonly: true,
  });
  try {
    const source = database
      .prepare(
        `SELECT source_root_rel_path, main_markdown_path
         FROM source_snapshots
         ORDER BY created_at, id
         LIMIT 1`,
      )
      .get() as {
      main_markdown_path: string;
      source_root_rel_path: string;
    };
    const sourcePath = resolve(
      e2eDataRoot,
      source.source_root_rel_path,
      source.main_markdown_path,
    );
    expect(await readFile(sourcePath, "utf8")).toBe(e2eHighMarkdown);
    expect((await stat(sourcePath)).mode & 0o222).toBe(0);
  } finally {
    database.close();
  }

  await page.goto("/manage");
  await upload(page, "generic.zip");
  await expect(page.getByText(/needs_main_confirmation/u)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("notes.md")).toBeVisible();
  await page.getByRole("button", { name: "确认使用此文件" }).click();
  await expect(page.getByText(/draft_ready/u)).toBeVisible({
    timeout: 30_000,
  });

  await page.goto("/manage");
  await upload(page, "ambiguous.zip");
  await expect(page.getByText(/rejected/u)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("IMPORT_AMBIGUOUS_CANDIDATES")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "确认使用此文件" }),
  ).toHaveCount(0);
});
