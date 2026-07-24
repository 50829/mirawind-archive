import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { openDatabase } from "@/db/connection";
import { JobRepository } from "@/db/repositories/jobs";

import {
  e2eAdministrator,
  e2eDataRoot,
  e2eOrigin,
} from "../helpers/global-setup.js";
import { startWorkerProcess } from "../helpers/processes.js";

async function waitForProcessExit(pid: number): Promise<void> {
  await expect
    .poll(
      () => {
        try {
          process.kill(pid, 0);
          return false;
        } catch (error) {
          return Boolean(
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "ESRCH",
          );
        }
      },
      { timeout: 15_000 },
    )
    .toBe(true);
}

function pointerSnapshot(): readonly {
  readonly current_version_id: string | null;
  readonly id: number;
}[] {
  const database = openDatabase(resolve(e2eDataRoot, "db", "mirawind.sqlite"), {
    role: "worker",
  });
  try {
    return database
      .prepare(
        `SELECT id, current_version_id FROM books
         ORDER BY id`,
      )
      .all() as {
      current_version_id: string | null;
      id: number;
    }[];
  } finally {
    database.close();
  }
}

test("shows, cancels, retries and recovers durable work without changing publication", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/login");
  await page.getByText("使用备用密码", { exact: true }).click();
  await page.getByLabel("管理员邮箱").fill(e2eAdministrator.email);
  await page.getByLabel("备用密码").fill(e2eAdministrator.password);
  await page.getByRole("button", { name: "使用备用密码登录" }).click();
  await expect(page).toHaveURL(/\/manage$/u);

  const before = pointerSnapshot();
  const workerPid = Number(
    (await readFile(resolve(e2eDataRoot, "tmp", "worker.pid"), "utf8")).trim(),
  );
  expect(Number.isSafeInteger(workerPid)).toBe(true);
  expect(
    (await readFile(`/proc/${workerPid}/cmdline`, "utf8")).replaceAll(
      "\0",
      " ",
    ),
  ).toContain("dist/processes/worker/index.js");
  expect(workerPid).not.toBe(process.pid);
  process.kill(workerPid, "SIGTERM");
  await waitForProcessExit(workerPid);

  const database = openDatabase(resolve(e2eDataRoot, "db", "mirawind.sqlite"), {
    role: "worker",
  });
  const jobs = new JobRepository(database);
  const nowMs = Date.now();
  const expired = jobs.create({ kind: "reclaim", nowMs: nowMs - 80_000 });
  jobs.claimNext({
    leaseOwner: "worker:simulated-dead-host",
    nowMs: nowMs - 70_000,
  });
  await mkdir(resolve(e2eDataRoot, "staging", expired.id), {
    recursive: true,
  });
  const queued = jobs.create({ kind: "reconcile", nowMs });
  database.close();

  await page.goto("/manage/tasks");
  const queuedCard = page.locator(".task-card").filter({
    hasText: queued.id,
  });
  await expect(queuedCard).toContainText("排队中");
  await queuedCard.getByRole("button", { name: "请求取消" }).click();
  await expect(queuedCard).toContainText("已取消");
  await queuedCard.getByRole("button", { name: "显式重试" }).click();
  await expect(page.getByText("新的重试尝试已进入队列")).toBeVisible();

  const replacementWorker = await startWorkerProcess({
    dataRoot: e2eDataRoot,
    publicOrigin: e2eOrigin,
  });
  try {
    await expect
      .poll(
        () => {
          const check = openDatabase(
            resolve(e2eDataRoot, "db", "mirawind.sqlite"),
            { role: "worker" },
          );
          try {
            const terminal = check
              .prepare(
                `SELECT retry_of_job_id, state, automatic_retry_count
                 FROM jobs
                 WHERE retry_of_job_id IN (?, ?)
                 ORDER BY retry_of_job_id`,
              )
              .all(expired.id, queued.id) as {
              automatic_retry_count: number;
              retry_of_job_id: string;
              state: string;
            }[];
            return Object.fromEntries(
              terminal.map((job) => [
                job.retry_of_job_id,
                {
                  automatic_retry_count: job.automatic_retry_count,
                  state: job.state,
                },
              ]),
            );
          } finally {
            check.close();
          }
        },
        { timeout: 30_000 },
      )
      .toEqual({
        [expired.id]: {
          automatic_retry_count: 1,
          state: "succeeded",
        },
        [queued.id]: {
          automatic_retry_count: 0,
          state: "succeeded",
        },
      });

    const check = openDatabase(resolve(e2eDataRoot, "db", "mirawind.sqlite"), {
      role: "worker",
    });
    try {
      expect(new JobRepository(check).get(expired.id)).toMatchObject({
        errorCode: "JOB_LEASE_EXPIRED",
        state: "interrupted",
      });
      expect(new JobRepository(check).get(queued.id)).toMatchObject({
        errorCode: "JOB_CANCELED",
        state: "canceled",
      });
    } finally {
      check.close();
    }
    expect(pointerSnapshot()).toEqual(before);
    await page.reload();
    await expect(
      page.locator(".task-card").filter({
        has: page.getByText(expired.id, { exact: true }),
      }),
    ).toContainText("已中断");
    const health = await page.request.get("/api/manage/health");
    expect(health.status()).toBe(200);
    expect(health.headers()["cache-control"]).toBe("private, no-store");
  } finally {
    if (replacementWorker.child.pid) {
      process.kill(replacementWorker.child.pid, "SIGTERM");
      await waitForProcessExit(replacementWorker.child.pid);
    }
  }
});
