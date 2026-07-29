import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import axe from "axe-core";
import Database from "better-sqlite3";

import { e2eDataRoot, e2eFixtureRoot } from "../helpers/global-setup.js";
import { loginAsAdministrator } from "../helpers/e2e-login.js";

const axeSource = axe.source;

async function expectNoSeriousAccessibilityFindings(page: Page) {
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => {
    const result = await (
      window as typeof window & {
        axe: {
          run: (
            context?: Document,
            options?: Readonly<Record<string, unknown>>,
          ) => Promise<{
            violations: readonly {
              impact: string | null;
              id: string;
              nodes: readonly { target: readonly string[] }[];
            }[];
          }>;
        };
      }
    ).axe.run(document, {
      resultTypes: ["violations"],
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
      },
    });
    return result.violations
      .filter(
        (violation) =>
          violation.impact === "critical" || violation.impact === "serious",
      )
      .map(({ id, impact, nodes }) => ({
        id,
        impact,
        targets: nodes.map((node) => node.target),
      }));
  });
  expect(violations).toEqual([]);
}

async function expectNoPageOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
}

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
          "/reader-assets/renderers/semantic-html-v4-katex-0.18.1/katex.css",
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

test("closes typography, formula and printed contents preview-to-publication behavior", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const rendererResponses: { status: number; url: string }[] = [];
  const rendererFailures: { error: string; url: string }[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/reader-assets/renderers/")) {
      rendererResponses.push({
        status: response.status(),
        url: response.url(),
      });
    }
  });
  page.on("requestfailed", (request) => {
    if (request.url().includes("/reader-assets/renderers/")) {
      rendererFailures.push({
        error: request.failure()?.errorText ?? "unknown",
        url: request.url(),
      });
    }
  });

  await loginAsAdministrator(page, "192.0.2.13");

  await page
    .getByLabel("MinerU ZIP")
    .setInputFiles(resolve(e2eFixtureRoot, "publishing-quality.zip"));
  await page.getByRole("button", { name: "上传并分析" }).click();
  await expect(page.getByRole("link", { name: "打开出版工作台" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("link", { name: "打开出版工作台" }).click();
  const sourceHandling = page.locator(".desktop-source-regions");
  await sourceHandling.locator("summary").click();
  await expect(sourceHandling).toContainText("zh-smart-v1");
  await expect(sourceHandling).toContainText("补齐空格");
  await expect(sourceHandling).toContainText("2");
  await expect(sourceHandling).toContainText("转换标点");
  await expect(sourceHandling).toContainText("3");
  await expect(sourceHandling).toContainText("保护节点");
  await expect(sourceHandling).toContainText("4");

  await expect(page.locator("iframe")).toHaveAttribute(
    "sandbox",
    "allow-scripts",
  );
  const previewSource = await page.locator("iframe").getAttribute("src");
  expect(previewSource).toBeTruthy();
  const previewResponse = await page.request.get(previewSource ?? "");
  expect(previewResponse.status()).toBe(200);
  expect(previewResponse.headers()["cache-control"]).toBe("private, no-store");
  expect(previewResponse.headers()["x-robots-tag"]).toContain("noindex");
  expect(previewResponse.headers()["referrer-policy"]).toBe("no-referrer");
  expect(previewResponse.headers()["cross-origin-resource-policy"]).toBe(
    "cross-origin",
  );
  expect(previewResponse.headers()["content-security-policy"]).toContain(
    "frame-ancestors http://127.0.0.1:4321",
  );

  const rendererStylesheet =
    "/reader-assets/renderers/semantic-html-v4-katex-0.18.1/katex.css";
  const rendererResponse = await page.request.get(rendererStylesheet);
  expect(rendererResponse.headers()["cache-control"]).toBe(
    "public, max-age=31536000, immutable",
  );
  expect(rendererResponse.headers()["access-control-allow-origin"]).toBe("*");
  expect(rendererResponse.headers()["cross-origin-resource-policy"]).toBe(
    "cross-origin",
  );
  const rendererPreflight = await page.request.fetch(rendererStylesheet, {
    headers: {
      "Access-Control-Request-Headers": "x-real-ip",
      "Access-Control-Request-Method": "GET",
      Origin: "null",
    },
    method: "OPTIONS",
  });
  expect(rendererPreflight.status()).toBe(204);
  expect(rendererPreflight.headers()["access-control-allow-origin"]).toBe("*");

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

  const katexStylesheet = "**/reader-assets/renderers/**/katex.css";
  await page.route(katexStylesheet, (route) => route.abort("blockedbyclient"));
  const previewIframe = page.locator("iframe");
  await previewIframe.evaluate((iframe: HTMLIFrameElement, source) => {
    iframe.src = `${String(source)}?blocked-katex=1`;
  }, previewSource);
  await expect(
    preview.getByText("中文 English123 测试，继续：结束？"),
  ).toBeVisible();
  await expect(preview.locator(".katex")).toHaveCount(1);
  await expectFormulaPresentation(preview);
  await page.unroute(katexStylesheet);
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
  await expect(page.getByRole("link", { name: "开始阅读" })).toBeVisible({
    timeout: 60_000,
  });
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
  await page.goto("/manage");

  await page
    .getByLabel("MinerU ZIP")
    .setInputFiles(resolve(e2eFixtureRoot, "printed-toc.zip"));
  await page.getByRole("button", { name: "上传并分析" }).click();
  await expect(page.getByRole("link", { name: "打开出版工作台" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("link", { name: "打开出版工作台" }).click();
  await expect(page.getByLabel(/作为层级参照/u)).toHaveCount(0);

  const printedPreview = page.frameLocator("iframe");
  await expect(
    printedPreview.getByRole("heading", { name: "目录" }),
  ).toHaveCount(0);
  await expect(printedPreview.locator(".reader-document")).not.toContainText(
    "...... 1",
  );
  await expect(
    printedPreview.getByRole("heading", { name: "第 1 章 绪论" }),
  ).toBeVisible();

  await expect(printedPreview.locator(".reader-document")).not.toContainText(
    "...... 1",
  );

  const databasePath = resolve(e2eDataRoot, "db", "mirawind.sqlite");
  const beforePublish = new Database(databasePath, { readonly: true });
  const book = (() => {
    try {
      return beforePublish
        .prepare(
          `SELECT books.id, source_snapshots.source_root_rel_path,
                  source_snapshots.main_markdown_path
           FROM books
           JOIN source_snapshots ON source_snapshots.id = books.draft_source_id
           WHERE books.title_cache = '第 1 章 绪论'
           ORDER BY books.id DESC LIMIT 1`,
        )
        .get() as {
        id: number;
        main_markdown_path: string;
        source_root_rel_path: string;
      };
    } finally {
      beforePublish.close();
    }
  })();
  const retainedMarkdown = await readFile(
    resolve(e2eDataRoot, book.source_root_rel_path, book.main_markdown_path),
    "utf8",
  );
  expect(retainedMarkdown).toContain("# 目录");
  expect(retainedMarkdown).toContain("# 第 1 章 绪论 ...... 1");

  await page.getByRole("button", { name: "发布当前修订" }).click();
  await expect(page.getByRole("link", { name: "开始阅读" })).toBeVisible({
    timeout: 60_000,
  });
  const firstVersion = new Database(databasePath, { readonly: true });
  const firstVersionId = (() => {
    try {
      return (
        firstVersion
          .prepare("SELECT current_version_id FROM books WHERE id = ?")
          .get(book.id) as { current_version_id: string }
      ).current_version_id;
    } finally {
      firstVersion.close();
    }
  })();

  const printedReadingHref = await page
    .getByRole("link", { name: "开始阅读" })
    .getAttribute("href");
  await page.goto(printedReadingHref ?? "");
  await expect(page.locator(".reader-document")).not.toContainText("...... 1");
  await expect(
    page.getByRole("navigation", { name: "全书目录" }),
  ).toContainText("中文与 English 排版");

  await page.goBack();
  await page.getByRole("button", { name: "发布当前修订" }).click();
  await expect(page.getByRole("button", { name: /发布中/u })).toBeVisible();
  await expect(page.getByRole("button", { name: "发布当前修订" })).toBeEnabled({
    timeout: 60_000,
  });
  const republished = new Database(databasePath, { readonly: true });
  try {
    const state = republished
      .prepare(
        `SELECT current_version_id,
                (SELECT COUNT(*) FROM book_versions WHERE book_id = books.id) AS version_count
         FROM books WHERE id = ?`,
      )
      .get(book.id) as {
      current_version_id: string;
      version_count: number;
    };
    expect(state.current_version_id).not.toBe(firstVersionId);
    expect(state.version_count).toBe(2);
  } finally {
    republished.close();
  }
});

test("keeps the published reader accessible across the responsive and zoom matrix", async ({
  page,
}, testInfo) => {
  for (const width of [320, 360, 768, 1_024, 1_440]) {
    await page.setViewportSize({ height: 900, width });
    await page.goto("/read/e2e-library-book/1");
    await expect(page.getByRole("main")).toContainText("A seeded public book");
    await expectNoPageOverflow(page);
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath(`reader-${width}.png`),
    });
  }

  await page.setViewportSize({ height: 900, width: 390 });
  await page.goto("/read/e2e-library-book/1");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await expectNoPageOverflow(page);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("reader-text-200.png"),
  });

  const chrome = await page.context().newCDPSession(page);
  await chrome.send("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 4,
    height: 225,
    mobile: false,
    width: 360,
  });
  await page.goto("/read/e2e-library-book/1");
  await expectNoPageOverflow(page);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("reader-zoom-400.png"),
  });
  await chrome.send("Emulation.clearDeviceMetricsOverride");

  await page.setViewportSize({ height: 900, width: 1_024 });
  await page.goto("/read/e2e-library-book/1");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "跳到正文" })).toBeFocused();
  await expect(page.getByRole("link", { name: "跳到正文" })).toBeVisible();
  await expectNoSeriousAccessibilityFindings(page);
});
