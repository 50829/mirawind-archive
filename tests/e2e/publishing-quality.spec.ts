import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import Database from "better-sqlite3";

import {
  e2eAdministrator,
  e2eDataRoot,
  e2eFixtureRoot,
} from "../helpers/global-setup.js";

async function expectFormulaPresentation(document: Page | FrameLocator) {
  const formula = document.locator(".katex").first();
  const mathml = formula.locator(".katex-mathml");
  const visual = formula.locator(".katex-html");

  await expect(formula).toBeVisible();
  await expect(mathml.locator("math")).toHaveCount(1);
  await expect(mathml).not.toHaveAttribute("aria-hidden", "true");
  await expect(visual).toHaveAttribute("aria-hidden", "true");
  await expect(visual).toBeVisible();
  await expect(mathml).toHaveCSS("position", "absolute");
  await expect(mathml).toHaveCSS("overflow", "hidden");
  await expect(mathml).toHaveCSS("clip-path", "inset(50%)");
}

function expectRendererClosure(
  responses: readonly { status: number; url: string }[],
  failures: readonly { error: string; url: string }[],
) {
  expect(failures).toEqual([]);
  expect(responses).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        status: 200,
        url: expect.stringContaining(
          "/_astro/renderers/semantic-html-v3-katex-0.18.1/katex.css",
        ),
      }),
      expect.objectContaining({
        status: 200,
        url: expect.stringMatching(/\.woff2$/u),
      }),
    ]),
  );
  expect(responses.every((response) => response.status < 400)).toBe(true);
}

test("keeps typography, KaTeX accessibility and local assets equal in preview and publication", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const rendererResponses: { status: number; url: string }[] = [];
  const rendererFailures: { error: string; url: string }[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/_astro/renderers/")) {
      rendererResponses.push({
        status: response.status(),
        url: response.url(),
      });
    }
  });
  page.on("requestfailed", (request) => {
    if (request.url().includes("/_astro/renderers/")) {
      rendererFailures.push({
        error: request.failure()?.errorText ?? "unknown",
        url: request.url(),
      });
    }
  });

  await page.goto("/login");
  await page.getByText("使用备用密码", { exact: true }).click();
  await page.getByLabel("管理员邮箱").fill(e2eAdministrator.email);
  await page.getByLabel("备用密码").fill(e2eAdministrator.password);
  await page.getByRole("button", { name: "使用备用密码登录" }).click();
  await expect(page).toHaveURL(/\/manage$/u);

  await page
    .getByLabel("MinerU ZIP")
    .setInputFiles(resolve(e2eFixtureRoot, "publishing-quality.zip"));
  await page.getByRole("button", { name: "上传并分析" }).click();
  await expect(page.getByText(/draft_ready/u)).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("link", { name: "打开结构预览" }).click();
  await expect(page.getByText("预览已就绪")).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole("heading", { name: "Markdown 预处理" }),
  ).toBeVisible();
  await expect(page.getByText(/zh-smart-v1/u)).toContainText("补齐空格 2");
  await expect(page.getByText(/zh-smart-v1/u)).toContainText("转换标点 3");
  await expect(page.getByText(/zh-smart-v1/u)).toContainText("保护节点 4");

  await expect(page.locator("iframe")).toHaveAttribute(
    "sandbox",
    "allow-same-origin",
  );
  const preview = page.frameLocator("iframe");
  await expect(
    preview.getByText("中文 English123 测试，继续：结束？"),
  ).toBeVisible();
  await expect(preview.locator("code.math-fallback")).toContainText(
    "\\notacommand{",
  );
  await expect(preview.locator(".katex")).toHaveCount(1);
  await expectFormulaPresentation(preview);
  await expect(preview.locator(".reader-document")).toHaveCSS(
    "font-family",
    /Georgia|Times New Roman|Noto Serif CJK SC/u,
  );
  const previewFrame = page
    .frames()
    .find((frame) => frame.url().includes("/preview/"));
  expect(previewFrame).toBeTruthy();
  await previewFrame?.evaluate(async () => document.fonts.ready);
  expectRendererClosure(rendererResponses, rendererFailures);
  rendererResponses.length = 0;
  rendererFailures.length = 0;

  const database = new Database(resolve(e2eDataRoot, "db", "mirawind.sqlite"), {
    readonly: true,
  });
  const source = (() => {
    try {
      return database
        .prepare(
          `SELECT source_snapshots.source_root_rel_path,
                  source_snapshots.main_markdown_path
           FROM source_snapshots
           JOIN books ON books.draft_source_id = source_snapshots.id
           WHERE books.title_cache = '排版质量'
           ORDER BY source_snapshots.created_at DESC, source_snapshots.id DESC
           LIMIT 1`,
        )
        .get() as {
        main_markdown_path: string;
        source_root_rel_path: string;
      };
    } finally {
      database.close();
    }
  })();
  const normalizedMarkdown = await readFile(
    resolve(
      e2eDataRoot,
      source.source_root_rel_path,
      source.main_markdown_path,
    ),
    "utf8",
  );
  expect(normalizedMarkdown).toContain("中文 English123 测试，继续：结束？");
  expect(normalizedMarkdown).toContain("https://example.com/a?x=1&y=2");
  expect(normalizedMarkdown).toContain("`v1.2.3`");
  expect(normalizedMarkdown).toContain("$x+y$");
  expect(normalizedMarkdown).toContain("\\notacommand{");

  await page.getByRole("button", { name: "发布当前修订" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "发布完成；新请求现在读取完整的新版本。" }),
  ).toBeVisible({ timeout: 60_000 });
  const readingHref = await page
    .getByRole("link", { name: "开始阅读" })
    .getAttribute("href");
  expect(readingHref).toBeTruthy();
  await page.goto(readingHref ?? "");
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => document.fonts.ready);

  await expect(
    page.getByText("中文 English123 测试，继续：结束？"),
  ).toBeVisible();
  await expect(page.locator("code.math-fallback")).toContainText(
    "\\notacommand{",
  );
  await expect(page.locator(".katex")).toHaveCount(1);
  await expectFormulaPresentation(page);
  await expect(page.locator(".reader-document")).toHaveCSS(
    "font-family",
    /Georgia|Times New Roman|Noto Serif CJK SC/u,
  );

  expectRendererClosure(rendererResponses, rendererFailures);
});
