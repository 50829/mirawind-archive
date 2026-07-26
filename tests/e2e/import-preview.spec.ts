import { stat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";

import {
  e2eDataRoot,
  e2eFixtureRoot,
  e2eHighMarkdown,
} from "../helpers/global-setup.js";
import { loginAsAdministrator } from "../helpers/e2e-login.js";

async function upload(page: import("@playwright/test").Page, filename: string) {
  await page
    .getByLabel("MinerU ZIP")
    .setInputFiles(resolve(e2eFixtureRoot, filename));
  await page.getByRole("button", { name: "上传并分析" }).click();
}

test("imports high-confidence and generic books, rejects ambiguity, and preserves the source snapshot", async ({
  page,
}) => {
  await loginAsAdministrator(page, "192.0.2.12");

  await upload(page, "high-confidence.zip");
  await expect(page.getByRole("link", { name: "打开出版工作台" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("link", { name: "打开出版工作台" }).click();
  await expect(
    page.getByRole("heading", { name: "E2E Cloud Book" }),
  ).toBeVisible();
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
        `SELECT source_snapshots.source_root_rel_path,
                source_snapshots.main_markdown_path
         FROM source_snapshots
         JOIN books ON books.draft_source_id = source_snapshots.id
         WHERE books.title_cache = 'E2E Cloud Book'
         ORDER BY source_snapshots.created_at DESC, source_snapshots.id DESC
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
  await expect(
    page.getByRole("button", { name: "确认使用此文件" }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("notes.md")).toBeVisible();
  await page.getByRole("button", { name: "确认使用此文件" }).click();
  await expect(page.getByRole("link", { name: "打开出版工作台" })).toBeVisible({
    timeout: 30_000,
  });

  await page.goto("/manage");
  await upload(page, "ambiguous.zip");
  await expect(page.getByText("IMPORT_AMBIGUOUS_CANDIDATES")).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole("button", { name: "确认使用此文件" }),
  ).toHaveCount(0);
});
