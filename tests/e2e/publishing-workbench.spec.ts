import { expect, test } from "@playwright/test";

import {
  expectNoPageOverflow,
  expectNoSeriousAccessibilityFindings,
} from "../helpers/accessibility.js";
import { loginAsAdministrator } from "../helpers/e2e-login.js";

const workbenchBookId = 1;

function draftProjection(
  size: number,
  diagnosticSeverity: "error" | "warning" = "warning",
) {
  const structure = Array.from({ length: size }, (_, index) => ({
    block_id: `blk_workbench_${String(index).padStart(16, "0")}`,
    display_level: (index % 4) + 1,
    include_in_toc: true,
    starts_page: index === 0,
    title_markdown: `Structure item ${index + 1}`,
  }));
  return {
    access: "private" as const,
    alias: null,
    book_id: workbenchBookId,
    boundaries: { body_start_block_id: structure[0]?.block_id },
    candidate: {
      attempt_id: "candidate_workbench_0000000001",
      preview_url: `/api/manage/books/${workbenchBookId}/preview/1/pages/1`,
      revision: 1,
      safe_error_code: null,
      semantic_digest: "b".repeat(64),
      state: "ready",
      version_id: "ver_workbench_000000000001",
    },
    candidate_published: false,
    config_revision: 1,
    diagnostics: [
      {
        blockId: structure[0]?.block_id,
        code: "WORKBENCH_TEST_DIAGNOSTIC",
        location: {
          blockId: structure[0]?.block_id,
          endByte: 40,
          regionId: "region_workbench_0001",
          startByte: 20,
        },
        message: "Locatable test diagnostic",
        severity: diagnosticSeverity,
        targets: [
          {
            blockId: structure[0]?.block_id,
            kind: "select_structure",
            pageId: 1,
          },
          { kind: "reprocess_verbatim" },
        ],
      },
    ],
    preview: {
      boundaries: { body_start_block_id: structure[0]?.block_id },
      compiler_version: "compiler-v6",
      config_revision: 1,
      config_sha256: "a".repeat(64),
      headings: structure.map((node, index) => ({
        ...node,
        page_id: 1,
        source_level: node.display_level,
        source_title: `Source item ${index + 1}`,
        title: node.title_markdown,
      })),
      is_stale: false,
      pages: [{ page_id: 1, title: "Preview page" }],
      renderer_version: "semantic-html-v6-katex-0.18.1",
      semantic_digest: "b".repeat(64),
      source_sha256: "c".repeat(64),
      typography: {
        profile: "zh-smart-v2",
        protected_nodes: 3,
        punctuation_converted: 2,
        spaces_normalized: 1,
      },
    },
    metadata: { title: `Workbench ${size}` },
    numbering: "source" as const,
    published: false,
    structure,
    title: `Workbench ${size}`,
  };
}

const editableBlockId = "blk_workbench_paragraph_000001";

function editablePreviewHtml(revision: number, markdown: string): string {
  return `<!doctype html>
    <html lang="zh-CN">
      <body>
        <p data-block-id="${editableBlockId}">${markdown}</p>
        <script>
          parent.postMessage({
            fragment: null,
            page_id: 1,
            revision: ${revision},
            type: "mirawind-preview-ready"
          }, "*");
          document.querySelector("[data-block-id]").addEventListener("click", () => {
            parent.postMessage({
              block_id: "${editableBlockId}",
              fragment: "${editableBlockId}",
              page_id: 1,
              revision: ${revision},
              type: "mirawind-preview-select-block"
            }, "*");
          });
        </script>
      </body>
    </html>`;
}

function draftAtRevision(revision: number, state: "building" | "ready") {
  const draft = draftProjection(20);
  return {
    ...draft,
    candidate: {
      ...draft.candidate,
      preview_url:
        state === "ready"
          ? `/api/manage/books/${workbenchBookId}/preview/${revision}/pages/1`
          : null,
      revision,
      state,
      version_id:
        state === "ready"
          ? `ver_workbench_${String(revision).padStart(18, "0")}`
          : null,
    },
    config_revision: revision,
    preview:
      state === "ready"
        ? {
            ...draft.preview,
            config_revision: revision,
          }
        : null,
  };
}

type MutableDraftProjection = Omit<
  ReturnType<typeof draftAtRevision>,
  | "access"
  | "alias"
  | "candidate_published"
  | "metadata"
  | "numbering"
  | "published"
> & {
  access: "private" | "public";
  alias: string | null;
  candidate_published: boolean;
  metadata: Record<string, unknown>;
  numbering: "generated" | "none" | "source";
  published: boolean;
};

test("loads the authoritative numbering mode from the draft", async ({
  page,
}) => {
  await loginAsAdministrator(page, "192.0.2.20");
  await page.goto(`/manage/books/${workbenchBookId}`);

  const numbering = page.getByRole("group", { name: "标题编号方式" });
  await expect(
    numbering.getByRole("button", { name: "自动编号" }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("retains conflicting numbering and unrelated heading edits", async ({
  page,
}) => {
  let draft: MutableDraftProjection = draftAtRevision(1, "ready");
  let patchCount = 0;
  const patchBodies: Record<string, unknown>[] = [];
  await page.route(
    `**/api/manage/books/${workbenchBookId}/draft`,
    async (route) => {
      if (route.request().method() === "PATCH") {
        patchCount += 1;
        patchBodies.push(
          route.request().postDataJSON() as Record<string, unknown>,
        );
        if (patchCount === 1) {
          draft = {
            ...draftAtRevision(2, "ready"),
            numbering: "generated",
          };
          await route.fulfill({
            body: JSON.stringify({ config_revision: 2 }),
            contentType: "application/json",
            headers: { ETag: '"draft-two"' },
            status: 202,
          });
          return;
        }
        await route.fulfill({ status: 412 });
        return;
      }
      await route.fulfill({
        body: JSON.stringify(draft),
        contentType: "application/json",
        headers: { ETag: `"draft-${draft.config_revision}"` },
        status: 200,
      });
    },
  );
  await page.route(
    `**/api/manage/books/${workbenchBookId}/preview/**`,
    (route) =>
      route.fulfill({
        body: "<!doctype html><html lang='zh-CN'><body>Preview</body></html>",
        contentType: "text/html",
        status: 200,
      }),
  );
  await loginAsAdministrator(page, "192.0.2.21");
  await page.goto(`/manage/books/${workbenchBookId}`);

  const numbering = page.getByRole("group", { name: "标题编号方式" });
  const save = page.getByRole("button", { name: "保存并更新预览" });
  await numbering.getByRole("button", { name: "自动编号" }).click();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(
    numbering.getByRole("button", { name: "自动编号" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(save).toBeDisabled();

  const title = page.getByRole("textbox", { name: "标题", exact: true });
  await title.fill("Unsaved local heading");
  await numbering.getByRole("button", { name: "无编号" }).click();
  await save.click();
  await expect(page.getByRole("alert")).toContainText("本地修改仍保留");
  await expect(
    numbering.getByRole("button", { name: "无编号" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(title).toHaveValue("Unsaved local heading");

  expect(patchBodies).toEqual([
    { changes: [], numbering: "generated" },
    {
      changes: [
        {
          block_id: "blk_workbench_0000000000000000",
          title_markdown: "Unsaved local heading",
        },
      ],
      numbering: "none",
    },
  ]);
  await page.getByRole("button", { name: "放弃本地修改并重新载入" }).click();
  await expect(
    numbering.getByRole("button", { name: "自动编号" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(title).toHaveValue("Structure item 1");
});

test("saves metadata and cover before publishing and changing access", async ({
  page,
}) => {
  let draft: MutableDraftProjection = draftAtRevision(1, "ready");
  let metadataPatch: Record<string, unknown> | null = null;
  let accessPatch: Record<string, unknown> | null = null;
  let coverUploaded = false;
  let publishBody: unknown = null;
  await page.route(
    `**/api/manage/books/${workbenchBookId}/draft`,
    async (route) => {
      if (route.request().method() === "PATCH") {
        metadataPatch = route.request().postDataJSON() as Record<
          string,
          unknown
        >;
        const metadata = metadataPatch.metadata as Record<string, unknown>;
        draft = {
          ...draftAtRevision(2, "ready"),
          access: draft.access,
          alias: (metadataPatch.alias as string | null) ?? null,
          metadata: { ...draft.metadata, ...metadata },
          published: draft.published,
          title: String(metadata.title),
        };
        await route.fulfill({
          body: JSON.stringify({ config_revision: 2 }),
          contentType: "application/json",
          headers: { ETag: '"etag-2"' },
          status: 202,
        });
        return;
      }
      await route.fulfill({
        body: JSON.stringify(draft),
        contentType: "application/json",
        headers: { ETag: `"etag-${draft.config_revision}"` },
        status: 200,
      });
    },
  );
  await page.route(
    `**/api/manage/books/${workbenchBookId}/draft/images`,
    (route) =>
      route.fulfill({
        body: JSON.stringify({ images: [] }),
        contentType: "application/json",
        status: 200,
      }),
  );
  await page.route(
    `**/api/manage/books/${workbenchBookId}/draft/cover`,
    async (route) => {
      coverUploaded = true;
      expect(route.request().headers()["if-match"]).toBe('"etag-2"');
      expect(route.request().headers()["content-type"]).toContain(
        "multipart/form-data",
      );
      draft = {
        ...draftAtRevision(3, "ready"),
        access: draft.access,
        alias: draft.alias,
        metadata: { ...draft.metadata, cover_path: "covers/uploaded.png" },
        published: draft.published,
        title: draft.title,
      };
      await route.fulfill({
        body: JSON.stringify({ config_revision: 3 }),
        contentType: "application/json",
        headers: { ETag: '"etag-3"' },
        status: 202,
      });
    },
  );
  await page.route(
    `**/api/manage/books/${workbenchBookId}/publish`,
    async (route) => {
      publishBody = route.request().postDataJSON();
      expect(route.request().headers()["if-match"]).toBe('"etag-3"');
      draft = { ...draft, candidate_published: true, published: true };
      await route.fulfill({
        body: JSON.stringify({ state: "published" }),
        contentType: "application/json",
        status: 200,
      });
    },
  );
  await page.route(
    `**/api/manage/books/${workbenchBookId}/access`,
    async (route) => {
      accessPatch = route.request().postDataJSON() as Record<string, unknown>;
      draft = { ...draft, access: "public" };
      await route.fulfill({
        body: JSON.stringify({ access: "public", book_id: workbenchBookId }),
        contentType: "application/json",
        status: 200,
      });
    },
  );
  await page.route(
    `**/api/manage/books/${workbenchBookId}/preview/**`,
    (route) =>
      route.fulfill({
        body: "<!doctype html><html lang='zh-CN'><body>Preview</body></html>",
        contentType: "text/html",
        status: 200,
      }),
  );

  await loginAsAdministrator(page, "192.0.2.18");
  await page.goto(`/manage/books/${workbenchBookId}`);
  await page.getByRole("button", { name: "书籍设置" }).click();
  await expect(page.getByRole("button", { name: "公开" })).toBeDisabled();
  await page.getByLabel("显示名称").fill("Edited Workbench");
  await page.getByLabel("路由别名").fill("edited-workbench");
  await page.getByLabel("作者或整理者").fill("Author One\nAuthor Two");
  await page.getByLabel("简介").fill("Edited description");
  await page.getByRole("button", { name: "保存设置并更新预览" }).click();
  await expect(page.getByRole("dialog", { name: "书籍设置" })).toBeHidden();
  expect(metadataPatch).toMatchObject({
    alias: "edited-workbench",
    changes: [],
    metadata: {
      authors: ["Author One", "Author Two"],
      description: "Edited description",
      title: "Edited Workbench",
    },
  });

  await page.getByRole("button", { name: "书籍设置" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "上传封面" }).click();
  await (
    await chooser
  ).setFiles({
    buffer: Buffer.from([1, 2, 3]),
    mimeType: "image/png",
    name: "cover.png",
  });
  await expect(page.getByRole("dialog", { name: "书籍设置" })).toBeHidden();
  expect(coverUploaded).toBe(true);

  await page.getByRole("button", { name: "发布当前修订" }).click();
  await expect(page.getByRole("link", { name: "开始阅读" })).toBeVisible();
  expect(publishBody).toEqual({});

  await page.getByRole("button", { name: "书籍设置" }).click();
  await page.getByRole("button", { name: "公开" }).click();
  await expect(page.getByRole("button", { name: "公开" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(accessPatch).toEqual({ access: "public" });
});

test("blocks publication only for error diagnostics", async ({ page }) => {
  let diagnosticSeverity: "error" | "warning" = "warning";
  await page.route(`**/api/manage/books/${workbenchBookId}/draft`, (route) =>
    route.fulfill({
      body: JSON.stringify(draftProjection(20, diagnosticSeverity)),
      contentType: "application/json",
      headers: { ETag: `"${"a".repeat(43)}"` },
      status: 200,
    }),
  );
  await page.route(
    `**/api/manage/books/${workbenchBookId}/preview/**`,
    (route) =>
      route.fulfill({
        body: "<!doctype html><html lang='en'><body>Preview</body></html>",
        contentType: "text/html",
        status: 200,
      }),
  );
  await loginAsAdministrator(page, "192.0.2.17");
  await page.goto(`/manage/books/${workbenchBookId}`);

  const publish = page.getByRole("button", { name: "发布当前修订" });
  await expect(publish).toBeEnabled();

  diagnosticSeverity = "error";
  await page.reload();
  await expect(publish).toBeDisabled();
});

test("keeps representative and stress structure DOM bounded", async ({
  page,
}) => {
  let size = 20;
  await page.route(`**/api/manage/books/${workbenchBookId}/draft`, (route) =>
    route.fulfill({
      body: JSON.stringify(draftProjection(size)),
      contentType: "application/json",
      headers: { ETag: `"${"a".repeat(43)}"` },
      status: 200,
    }),
  );
  await page.route(
    `**/api/manage/books/${workbenchBookId}/preview/**`,
    (route) =>
      route.fulfill({
        body: "<!doctype html><html lang='en'><body>Preview</body></html>",
        contentType: "text/html",
        status: 200,
      }),
  );
  await loginAsAdministrator(page, "192.0.2.14");

  for (const representativeSize of [20, 250, 501, 2_000]) {
    size = representativeSize;
    await page.goto(`/manage/books/${workbenchBookId}?size=${size}`);
    await expect(
      page.getByRole("heading", { name: `Workbench ${size}` }),
    ).toBeVisible();
    const renderedRows = page.locator(".structure-tree > li");
    await expect(renderedRows.first()).toBeVisible();
    expect(await renderedRows.count()).toBeLessThanOrEqual(30);

    const search = page.getByRole("searchbox", { name: "搜索结构" });
    if (representativeSize === 20) {
      const firstChild = page
        .locator(".structure-tree")
        .getByRole("button", { name: "Structure item 2", exact: true });
      await expect(firstChild).toBeVisible();
      await page.getByRole("button", { name: "折叠子项" }).first().click();
      await expect(firstChild).toBeHidden();
      await search.fill("Structure item 2");
      await expect(firstChild).toBeVisible();
      await search.fill("");
      await page.getByRole("button", { name: "展开子项" }).first().click();
      await expect(firstChild).toBeVisible();
    }
    await search.fill(`Structure item ${size}`);
    await expect(
      page
        .locator(".structure-tree")
        .getByRole("button", { name: `Structure item ${size}`, exact: true }),
    ).toBeVisible();
  }

  size = 20_000;
  await page.goto(`/manage/books/${workbenchBookId}?size=${size}`);
  await expect(
    page.getByRole("heading", { name: `Workbench ${size}` }),
  ).toBeVisible();
  const stressRows = page.locator(".structure-tree > li");
  await expect(stressRows.first()).toBeVisible();
  expect(await stressRows.count()).toBeLessThanOrEqual(30);
  await page.goto("/manage");
  await expect(page.getByRole("heading", { name: "准备一本书" })).toBeVisible();
});

test("locates diagnostics and disables reprocessing while edits are dirty", async ({
  page,
}) => {
  await page.route(`**/api/manage/books/${workbenchBookId}/draft`, (route) => {
    return route.fulfill({
      body: JSON.stringify(draftProjection(20)),
      contentType: "application/json",
      headers: { ETag: `"${"a".repeat(43)}"` },
      status: 200,
    });
  });
  await page.route(
    `**/api/manage/books/${workbenchBookId}/preview/**`,
    (route) =>
      route.fulfill({
        body: "<!doctype html><html lang='en'><body>Preview</body></html>",
        contentType: "text/html",
        status: 200,
      }),
  );
  await loginAsAdministrator(page, "192.0.2.16");
  await page.goto(`/manage/books/${workbenchBookId}`);

  await page.getByRole("button", { name: "定位结构" }).click();
  await expect(
    page.locator(".structure-tree [aria-current=true]"),
  ).toContainText("Structure item 1");
  await expect(page.locator("iframe")).toHaveAttribute(
    "src",
    /#blk_workbench_0000000000000000$/u,
  );

  const title = page.getByRole("textbox", { name: "标题" });
  await title.fill("Unsaved local title");
  await expect(title).toHaveValue("Unsaved local title");
  await expect(
    page.getByRole("button", { name: "按原文重新处理" }),
  ).toBeDisabled();
});

test("restores focus after each mobile workbench detail dialog", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ height: 800, width: 320 });
  await page.route(`**/api/manage/books/${workbenchBookId}/draft`, (route) =>
    route.fulfill({
      body: JSON.stringify(draftProjection(20)),
      contentType: "application/json",
      headers: { ETag: `"${"a".repeat(43)}"` },
      status: 200,
    }),
  );
  await page.route(
    `**/api/manage/books/${workbenchBookId}/preview/**`,
    (route) =>
      route.fulfill({
        body: "<!doctype html><html lang='en'><body>Preview</body></html>",
        contentType: "text/html",
        status: 200,
      }),
  );
  await loginAsAdministrator(page, "192.0.2.15");
  await page.goto(`/manage/books/${workbenchBookId}`);
  await page.getByRole("button", { name: "结构", exact: true }).click();

  const currentItem = page.getByRole("button", { name: "当前项" });
  await currentItem.click();
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "当前结构项" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭当前项编辑" }).click();
  await expect(currentItem).toBeFocused();

  const sourceHandling = page.getByRole("button", {
    name: "源处理",
    exact: true,
  });
  await sourceHandling.click();
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "源处理" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭源处理" }).click();
  await expect(sourceHandling).toBeFocused();

  const diagnostics = page.getByRole("button", { name: "1 个问题" });
  await diagnostics.click();
  await expect(
    page.getByRole("dialog").getByText("WORKBENCH_TEST_DIAGNOSTIC"),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭问题列表" }).click();
  await expect(diagnostics).toBeFocused();
  await expectNoSeriousAccessibilityFindings(page);

  for (const width of [320, 360, 768, 1_024, 1_440]) {
    await page.setViewportSize({ height: 900, width });
    await expectNoPageOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`workbench-${width}.png`),
    });
  }

  await page.setViewportSize({ height: 900, width: 390 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await expectNoPageOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("workbench-text-200.png"),
  });
});

test("edits a selected preview block and keeps the last preview while rebuilding", async ({
  page,
}) => {
  let revision = 1;
  let buildingResponsePending = false;
  let patchBody: unknown;
  let patchEtag = "";
  await page.route(`**/api/manage/books/${workbenchBookId}/draft`, (route) => {
    if (buildingResponsePending) {
      buildingResponsePending = false;
      return route.fulfill({
        body: JSON.stringify(draftAtRevision(2, "building")),
        contentType: "application/json",
        headers: { ETag: '"draft-two"' },
        status: 200,
      });
    }
    return route.fulfill({
      body: JSON.stringify(draftAtRevision(revision, "ready")),
      contentType: "application/json",
      headers: { ETag: `"draft-${revision}"` },
      status: 200,
    });
  });
  await page.route(
    `**/api/manage/books/${workbenchBookId}/draft/blocks/${editableBlockId}`,
    async (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({
          body: JSON.stringify({
            block_id: editableBlockId,
            kind: "paragraph",
            markdown: "Original paragraph",
          }),
          contentType: "application/json",
          headers: { ETag: '"block-one"' },
          status: 200,
        });
      }
      patchBody = route.request().postDataJSON();
      patchEtag = route.request().headers()["if-match"] ?? "";
      revision = 2;
      buildingResponsePending = true;
      return route.fulfill({
        body: JSON.stringify({ config_revision: 2 }),
        contentType: "application/json",
        headers: { ETag: '"block-two"' },
        status: 202,
      });
    },
  );
  await page.route(
    `**/api/manage/books/${workbenchBookId}/preview/**`,
    (route) => {
      const nextRevision = route.request().url().includes("/preview/2/")
        ? 2
        : 1;
      return route.fulfill({
        body: editablePreviewHtml(
          nextRevision,
          nextRevision === 1 ? "Original paragraph" : "Updated paragraph",
        ),
        contentType: "text/html",
        status: 200,
      });
    },
  );
  await loginAsAdministrator(page, "192.0.2.18");
  await page.goto(`/manage/books/${workbenchBookId}`);

  const preview = page.frameLocator("iframe");
  await preview.getByText("Original paragraph").click();
  const dialog = page.getByRole("dialog", { name: "编辑段落" });
  const markdown = dialog.getByRole("textbox", { name: "Markdown" });
  await expect(markdown).toHaveValue("Original paragraph");
  await markdown.fill("Updated paragraph");
  await dialog.getByRole("button", { name: "保存正文并更新预览" }).click();

  expect(patchBody).toEqual({ markdown: "Updated paragraph" });
  expect(patchEtag).toBe('"block-one"');
  await expect(page.getByText("正在生成阅读预览")).toBeVisible();
  await expect(preview.getByText("Original paragraph")).toBeVisible();
  await expect(preview.getByText("Updated paragraph")).toBeVisible({
    timeout: 3_000,
  });
});

test("keeps local block Markdown after an If-Match conflict", async ({
  page,
}) => {
  let currentMarkdown = "Server paragraph";
  await page.route(`**/api/manage/books/${workbenchBookId}/draft`, (route) =>
    route.fulfill({
      body: JSON.stringify(draftAtRevision(1, "ready")),
      contentType: "application/json",
      headers: { ETag: '"draft-one"' },
      status: 200,
    }),
  );
  await page.route(
    `**/api/manage/books/${workbenchBookId}/draft/blocks/${editableBlockId}`,
    (route) => {
      if (route.request().method() === "PATCH") {
        currentMarkdown = "Concurrent server paragraph";
        return route.fulfill({ status: 412 });
      }
      return route.fulfill({
        body: JSON.stringify({
          block_id: editableBlockId,
          kind: "paragraph",
          markdown: currentMarkdown,
        }),
        contentType: "application/json",
        headers: { ETag: '"block-current"' },
        status: 200,
      });
    },
  );
  await page.route(
    `**/api/manage/books/${workbenchBookId}/preview/**`,
    (route) =>
      route.fulfill({
        body: editablePreviewHtml(1, "Server paragraph"),
        contentType: "text/html",
        status: 200,
      }),
  );
  await loginAsAdministrator(page, "192.0.2.19");
  await page.goto(`/manage/books/${workbenchBookId}`);

  await page.frameLocator("iframe").getByText("Server paragraph").click();
  const dialog = page.getByRole("dialog", { name: "编辑段落" });
  const markdown = dialog.getByRole("textbox", { name: "Markdown" });
  await markdown.fill("Unsaved local paragraph");
  await dialog.getByRole("button", { name: "保存正文并更新预览" }).click();
  await expect(markdown).toHaveValue("Unsaved local paragraph");
  await expect(dialog.getByRole("alert")).toContainText("本地正文仍保留");

  await dialog.getByRole("button", { name: "放弃本地修改并重新载入" }).click();
  await expect(markdown).toHaveValue("Concurrent server paragraph");
});
