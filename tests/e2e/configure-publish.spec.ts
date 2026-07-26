import { chmod, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";

import {
  e2eDataRoot,
  e2eFixtureRoot,
  e2eOrigin,
} from "../helpers/global-setup.js";
import { loginAsAdministrator } from "../helpers/e2e-login.js";

test("edits every M1 structure override and preserves the old version on a failed rebuild", async ({
  browser,
  page,
}) => {
  test.setTimeout(90_000);
  await loginAsAdministrator(page, "192.0.2.11");

  await page
    .getByLabel("MinerU ZIP")
    .setInputFiles(resolve(e2eFixtureRoot, "publish.zip"));
  await page.getByRole("button", { name: "上传并分析" }).click();
  await expect(page.getByRole("link", { name: "打开出版工作台" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("link", { name: "打开出版工作台" }).click();
  await expect(page.locator("iframe")).toBeVisible();

  const selectStructure = async (sourceTitle: string) => {
    await page
      .locator(".structure-tree")
      .getByRole("button", { exact: true, name: sourceTitle })
      .click();
  };
  const selectedEditor = page.locator(".desktop-node-editor");
  await selectStructure("Front");
  await selectedEditor.getByLabel("内容角色").selectOption("frontmatter");
  await selectStructure("Main");
  await selectedEditor.getByLabel("显示标题").fill("Published Main");
  await selectedEditor.getByLabel("内容角色").selectOption("body");
  await selectStructure("Details");
  await selectedEditor.getByLabel("显示层级").selectOption("3");
  await selectedEditor.getByLabel("显示在目录").uncheck();
  await selectedEditor.getByLabel("从此标题开始新页面").check();
  await selectStructure("Appendix");
  await selectedEditor.getByLabel("内容角色").selectOption("appendix");
  await selectStructure("Back");
  await selectedEditor.getByLabel("内容角色").selectOption("backmatter");
  await page.getByRole("button", { name: "保存并重建" }).click();
  await expect(
    page.getByText("修改未保存，请检查层级、角色和诊断信息。"),
  ).toBeVisible();

  await selectStructure("Details");
  await selectedEditor.getByLabel("显示层级").selectOption("2");
  await page.getByRole("button", { name: "保存并重建" }).click();
  await expect(page.getByText("正在构建预览")).toBeVisible();
  await expect(page.getByRole("button", { name: "发布当前修订" })).toBeEnabled({
    timeout: 30_000,
  });

  await page.getByRole("button", { name: "发布当前修订" }).click();
  await expect(page.getByRole("link", { name: "开始阅读" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole("link", { name: "查看图书" })).toHaveAttribute(
    "href",
    /\/books\/[a-z0-9-]+|\/books\/[1-9][0-9]*/u,
  );
  await expect(page.getByRole("link", { name: "开始阅读" })).toHaveAttribute(
    "href",
    /\/read\//u,
  );
  await expect(page.getByRole("link", { name: "返回书库" })).toHaveAttribute(
    "href",
    "/library",
  );

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
  const readerSearch = anonymousPage
    .getByRole("region", { name: "书内搜索" })
    .first();
  await readerSearch
    .getByRole("searchbox", { name: "搜索本书" })
    .fill("Published");
  await readerSearch.getByRole("button", { name: "搜索" }).click();
  await expect(readerSearch.locator("[data-search-results]")).toContainText(
    "Published body.",
  );
  await readerSearch.getByRole("searchbox", { name: "搜索本书" }).fill("P");
  await readerSearch.getByRole("button", { name: "搜索" }).click();
  await expect(readerSearch.locator("[data-search-notice]")).toContainText(
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
