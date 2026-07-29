import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import type { APIRoute } from "astro";

import { requireRuntimeAdministrator } from "@/http/authorization/runtime-admin";
import { applyResponsePolicy } from "@/http/cache/policies";
import { operationalMetrics } from "@/observability/metrics";
import {
  getRuntimeEnvironment,
  getRuntimeStorageLayout,
} from "@/composition/storage";

export const prerender = false;

async function workerHealth(path: string): Promise<unknown | null> {
  try {
    const metadata = await stat(path);
    if (!metadata.isFile() || metadata.size > 64 * 1024) return null;
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

export const GET: APIRoute = async ({ locals }) => {
  const { database } = requireRuntimeAdministrator(locals.session, {
    hideExistence: true,
  });
  const layout = await getRuntimeStorageLayout();
  const environment = getRuntimeEnvironment();
  const running = database
    .prepare(
      `SELECT COUNT(*) AS count, MIN(lease_until) AS earliest
       FROM jobs WHERE state = 'running'`,
    )
    .get() as { count: number; earliest: number | null };
  const walBytes = await stat(
    resolve(environment.dataDirectory, "db", "mirawind.sqlite-wal"),
  )
    .then((metadata) => metadata.size)
    .catch(() => 0);
  const headers = new Headers();
  applyResponsePolicy(headers, "private-api");
  return Response.json(
    {
      lease: {
        active_jobs: running.count,
        earliest_expiry:
          running.earliest === null
            ? null
            : new Date(running.earliest).toISOString(),
      },
      metrics: operationalMetrics.snapshot(),
      wal_bytes: walBytes,
      worker: await workerHealth(
        resolve(layout.temporaryDirectory, "worker-health.json"),
      ),
    },
    { headers },
  );
};
