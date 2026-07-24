import { chmod, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";

import {
  e2eAdministrator,
  e2eDataRoot,
  e2eFixtureRoot,
} from "../helpers/global-setup.js";

test("edits every M1 structure override and preserves the old version on a failed rebuild", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByText("使用备用密码", { exact: true }).click();
  await page.getByLabel("管理员邮箱").fill(e2eAdministrator.email);
  await page.getByLabel("备用密码").fill(e2eAdministrator.password);
  await page.getByRole("button", { name: "使用备用密码登录" }).click();
  await expect(page).toHaveURL(/\/manage$/u);

  await page
    .getByLabel("MinerU ZIP")
    .setInputFiles(resolve(e2eFixtureRoot, "publish.zip"));
  await page.getByRole("button", { name: "上传并分析" }).click();
  await expect(page.getByText(/draft_ready/u)).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("link", { name: "打开结构预览" }).click();
  await expect(page.getByText("预览已就绪")).toBeVisible({
    timeout: 30_000,
  });

  const row = (sourceTitle: string) =>
    page
      .locator(".structure-edit-list > li")
      .filter({ hasText: `源标题：${sourceTitle}` });
  await row("Front").getByLabel("内容角色").selectOption("frontmatter");
  await row("Main").getByLabel("显示标题").fill("Published Main");
  await row("Main").getByLabel("内容角色").selectOption("body");
  await row("Details").getByLabel("显示层级").selectOption("3");
  await row("Details").getByLabel("显示在目录").uncheck();
  await row("Details").getByLabel("从此标题开始新页面").check();
  await row("Appendix").getByLabel("内容角色").selectOption("appendix");
  await row("Back").getByLabel("内容角色").selectOption("backmatter");
  await page.getByRole("button", { name: "保存并重建预览" }).click();
  await expect(
    page.getByText("配置未保存。请检查层级、角色和诊断信息。"),
  ).toBeVisible();

  await row("Details").getByLabel("显示层级").selectOption("2");
  await page.getByRole("button", { name: "保存并重建预览" }).click();
  await expect(page.getByText(/配置修订 2/u)).toBeVisible();
  await expect(page.getByText("预览已就绪")).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("button", { name: "发布当前修订" }).click();
  await expect(page.getByText(/发布完成/u)).toBeVisible({ timeout: 60_000 });

  const databasePath = resolve(e2eDataRoot, "db", "mirawind.sqlite");
  const database = new Database(databasePath);
  const published = (() => {
    try {
      return database
        .prepare(
          `SELECT books.id, books.current_version_id, source_snapshots.source_root_rel_path,
                source_snapshots.main_markdown_path
         FROM books
         JOIN source_snapshots ON source_snapshots.id = books.draft_source_id
         WHERE books.visibility = 'public'
         ORDER BY books.id DESC LIMIT 1`,
        )
        .get() as {
        current_version_id: string;
        id: number;
        main_markdown_path: string;
        source_root_rel_path: string;
      };
    } finally {
      database.close();
    }
  })();
  const sourcePath = resolve(
    e2eDataRoot,
    published.source_root_rel_path,
    published.main_markdown_path,
  );
  const originalSource = await readFile(sourcePath, "utf8");
  await chmod(sourcePath, 0o600);
  await writeFile(sourcePath, `${originalSource}\ncorrupt after publish`);

  try {
    await page.getByRole("button", { name: "发布当前修订" }).click();
    await expect(
      page.getByText(/发布未完成.*读者仍读取上一已发布版本/u),
    ).toBeVisible({ timeout: 60_000 });
    const check = new Database(databasePath, { readonly: true });
    try {
      expect(
        (
          check
            .prepare(
              "SELECT current_version_id FROM books WHERE visibility = 'public' ORDER BY id DESC LIMIT 1",
            )
            .get() as { current_version_id: string }
        ).current_version_id,
      ).toBe(published.current_version_id);
    } finally {
      check.close();
    }
  } finally {
    await writeFile(sourcePath, originalSource);
    await chmod(sourcePath, 0o400);
  }
});
