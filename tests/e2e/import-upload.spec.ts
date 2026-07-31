import { expect, test } from "@playwright/test";

import { loginAsAdministrator } from "../helpers/e2e-login.js";

test("keeps upload progress honest across retry, acceptance and abort", async ({
  page,
}) => {
  let importStatusRequests = 0;
  await page.addInitScript(() => {
    type ProgressHandler = ((event: ProgressEvent) => void) | null;
    type TestWindow = Window & {
      __uploadAttempt: number;
      __uploadKeys: string[];
      __uploadProgress: number[];
    };
    const testWindow = window as unknown as TestWindow;
    testWindow.__uploadAttempt = 0;
    testWindow.__uploadKeys = [];
    testWindow.__uploadProgress = [];

    class ControlledUploadRequest {
      readonly upload: { onprogress: ProgressHandler } = { onprogress: null };
      onabort: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      responseText = "";
      status = 0;

      abort() {
        this.onabort?.();
      }

      open() {}

      send() {
        testWindow.__uploadAttempt += 1;
        const attempt = testWindow.__uploadAttempt;
        const progress = (loaded: number) =>
          this.upload.onprogress?.(
            new ProgressEvent("progress", {
              lengthComputable: true,
              loaded,
              total: 100,
            }),
          );
        if (attempt === 1) {
          setTimeout(() => progress(20), 10);
          setTimeout(() => this.onerror?.(), 30);
          return;
        }
        if (attempt === 2) {
          setTimeout(() => progress(25), 10);
          setTimeout(() => progress(10), 20);
          setTimeout(() => progress(100), 30);
          setTimeout(() => {
            this.status = 202;
            this.responseText = JSON.stringify({
              import_id: "imp_controlled_upload_0001",
            });
            this.onload?.();
          }, 400);
          return;
        }
        setTimeout(() => progress(35), 10);
      }

      setRequestHeader(name: string, value: string) {
        if (name.toLowerCase() === "idempotency-key") {
          testWindow.__uploadKeys.push(value);
        }
      }
    }

    Object.defineProperty(window, "XMLHttpRequest", {
      configurable: true,
      value: ControlledUploadRequest,
      writable: true,
    });
  });
  await page.route(
    "**/api/manage/imports/imp_controlled_upload_0001",
    (route) => {
      importStatusRequests += 1;
      const ready = importStatusRequests > 1;
      return route.fulfill({
        body: JSON.stringify({
          book_id: 99,
          candidates: [],
          current_job: {
            attempt: 1,
            cancellation_requested_at: null,
            error_class: null,
            error_code: null,
            job_id: "job_controlled_candidate_0001",
            kind: ready ? "build_candidate" : "analyze_import",
            phase: ready ? "complete" : "identify_document",
            progress: {
              completed: 1,
              processed_bytes: null,
              total: ready ? 1 : 4,
              unit: "steps",
            },
            state: ready ? "succeeded" : "running",
            subject: {
              kind: "import",
              label: "controlled.zip",
            },
          },
          error_code: null,
          import_id: "imp_controlled_upload_0001",
          source_name: "controlled.zip",
          preview: {
            revision: 1,
            state: ready ? "ready" : "building",
            url: ready ? "/manage/books/99" : null,
          },
          state: ready ? "draft_ready" : "analyzing",
        }),
        contentType: "application/json",
        status: 200,
      });
    },
  );

  await loginAsAdministrator(page, "192.0.2.16");

  const fileInput = page.getByLabel("MinerU ZIP");
  await fileInput.setInputFiles({
    buffer: Buffer.from("first"),
    mimeType: "application/zip",
    name: "controlled.zip",
  });
  await page.getByRole("button", { name: "上传并分析" }).click();
  await expect(
    page.getByText("网络中断，重新提交会安全续用本次请求标识。"),
  ).toBeVisible();

  await page.evaluate(() => {
    const testWindow = window as unknown as Window & {
      __uploadProgress: number[];
    };
    const record = () => {
      const label = document
        .querySelector("[aria-label^='上传进度']")
        ?.getAttribute("aria-label");
      const percent = label?.match(/\d+/u)?.[0];
      if (percent) testWindow.__uploadProgress.push(Number(percent));
    };
    new MutationObserver(record).observe(document.body, {
      attributeFilter: ["aria-label"],
      attributes: true,
      childList: true,
      subtree: true,
    });
  });

  await page.getByRole("button", { name: "上传并分析" }).click();
  await expect(page.getByText("正在安全保存并排队")).toBeVisible();
  await expect(page.getByText("controlled.zip", { exact: true })).toBeVisible();
  await expect(page.getByLabel("后台处理进度 25%")).toBeVisible();
  await expect(page.getByText("识别正文 · 25%", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "打开出版工作台" }),
  ).toBeVisible();

  const progress = await page.evaluate(
    () =>
      (window as unknown as Window & { __uploadProgress: number[] })
        .__uploadProgress,
  );
  expect(progress.length).toBeGreaterThan(0);
  expect(progress).toEqual([...progress].sort((left, right) => left - right));
  expect(progress.at(-1)).toBe(100);

  const retryKeys = await page.evaluate(
    () =>
      (window as unknown as Window & { __uploadKeys: string[] }).__uploadKeys,
  );
  expect(retryKeys).toHaveLength(2);
  expect(retryKeys[1]).toBe(retryKeys[0]);

  await fileInput.setInputFiles({
    buffer: Buffer.from("second"),
    mimeType: "application/zip",
    name: "cancel.zip",
  });
  await page.getByRole("button", { name: "上传并分析" }).click();
  await expect(page.getByLabel(/上传进度 35%/u)).toBeVisible();
  await page.getByRole("button", { exact: true, name: "取消" }).click();
  await expect(page.getByText("上传已取消。")).toBeVisible();

  const finalKeys = await page.evaluate(
    () =>
      (window as unknown as Window & { __uploadKeys: string[] }).__uploadKeys,
  );
  expect(finalKeys).toHaveLength(3);
  expect(finalKeys[2]).not.toBe(finalKeys[1]);
});
