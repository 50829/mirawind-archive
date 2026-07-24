import { chmod, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";

import {
  e2eAdministrator,
  e2eDataRoot,
  e2eFixtureRoot,
  e2eOrigin,
} from "../helpers/global-setup.js";

test("edits every M1 structure override and preserves the old version on a failed rebuild", async ({
  browser,
  page,
}) => {
  test.setTimeout(90_000);
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
          `SELECT books.id, books.current_version_id,
                  source_snapshots.source_root_rel_path,
                  source_snapshots.main_markdown_path,
                  original_files.id AS original_file_id
         FROM books
         JOIN book_versions ON book_versions.id = books.current_version_id
         JOIN source_snapshots ON source_snapshots.id = books.draft_source_id
         JOIN original_files
           ON original_files.book_id = books.id
          AND original_files.source_id = book_versions.source_id
         WHERE books.visibility = 'public'
         ORDER BY books.id DESC LIMIT 1`,
        )
        .get() as {
        current_version_id: string;
        id: number;
        main_markdown_path: string;
        original_file_id: string;
        source_root_rel_path: string;
      };
    } finally {
      database.close();
    }
  })();
  const anonymous = await browser.newContext({ baseURL: e2eOrigin });
  const anonymousPage = await anonymous.newPage();
  const readingResponse = await anonymousPage.goto(`/read/${published.id}`);
  expect(readingResponse?.status()).toBe(200);
  expect(readingResponse?.headers()["cache-control"]).toBe(
    "public, max-age=0, must-revalidate",
  );
  await expect(
    anonymousPage.getByRole("navigation", { name: "全书目录" }),
  ).toBeVisible();
  await expect(
    anonymousPage.getByRole("navigation", { name: "本页提纲" }),
  ).toBeVisible();
  await expect(anonymousPage.getByRole("main")).toContainText("Opening.");
  await anonymousPage
    .getByRole("searchbox", { name: "搜索本书" })
    .fill("Published");
  await anonymousPage.getByRole("button", { name: "搜索" }).click();
  await expect(anonymousPage.locator("[data-search-results]")).toContainText(
    "Published body.",
  );
  await anonymousPage.getByRole("searchbox", { name: "搜索本书" }).fill("P");
  await anonymousPage.getByRole("button", { name: "搜索" }).click();
  await expect(anonymousPage.locator("[data-search-notice]")).toContainText(
    "1–2 个字符只搜索书名、作者和章节标题",
  );

  await anonymousPage.locator("a[rel='next']").click();
  await anonymousPage.locator("a[rel='next']").click();
  await expect(anonymousPage.locator("table")).toBeVisible();
  await expect(anonymousPage.locator("figure figcaption")).toHaveText("Pixel");
  await expect(
    anonymousPage.locator("code[data-code-language='typescript']"),
  ).toBeVisible();
  await expect(anonymousPage.locator("[role='doc-noteref']")).toBeVisible();
  await expect(anonymousPage.locator(".katex")).toBeVisible();
  await expect(
    anonymousPage.locator("aside[data-container-kind='note']"),
  ).toBeVisible();
  await expect(anonymousPage.locator("canvas, iframe")).toHaveCount(0);
  const assetUrl = await anonymousPage.locator("img").getAttribute("src");
  expect(assetUrl).toBeTruthy();
  expect(assetUrl).toContain(published.current_version_id);
  const assetResponse = await anonymous.request.get(assetUrl ?? "");
  expect(assetResponse.status()).toBe(200);
  expect(assetResponse.headers()["cache-control"]).toBe(
    "private, max-age=31536000, immutable",
  );
  const originalUrl = `/books/${published.id}/originals/${published.original_file_id}`;
  const fullDownload = await anonymous.request.get(originalUrl);
  expect(fullDownload.status()).toBe(200);
  expect(fullDownload.headers()["cache-control"]).toBe("private, no-store");
  expect(fullDownload.headers()["content-disposition"]).toContain(
    `filename="book-${published.id}.zip"`,
  );
  const fullBytes = await fullDownload.body();
  const rangeDownload = await anonymous.request.get(originalUrl, {
    headers: { Range: "bytes=-16" },
  });
  expect(rangeDownload.status()).toBe(206);
  expect(await rangeDownload.body()).toEqual(fullBytes.subarray(-16));

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

  const visibility = await page.request.patch(
    `/api/manage/books/${published.id}/visibility`,
    {
      data: { visibility: "private" },
      headers: { Origin: e2eOrigin },
    },
  );
  expect(visibility.status()).toBe(200);
  expect((await anonymousPage.goto(`/read/${published.id}/1`))?.status()).toBe(
    404,
  );
  expect(
    (
      await anonymous.request.get(
        `/api/books/${published.id}/search?q=Published`,
      )
    ).status(),
  ).toBe(404);
  expect((await anonymous.request.get(assetUrl ?? "")).status()).toBe(404);
  expect((await anonymous.request.get(originalUrl)).status()).toBe(404);
  await anonymous.close();
});
