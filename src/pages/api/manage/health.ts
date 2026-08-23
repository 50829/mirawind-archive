import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import type { APIRoute } from "astro";

import { requireRuntimeAdministrator } from "@/http/authorization/runtime-admin";
import { applyResponsePolicy } from "@/http/cache/policies";
import { operationalMetrics } from "@/observability/metrics";
import { readWorkerHealthSnapshot } from "@/observability/worker-health";
import {
  getRuntimeEnvironment,
  getRuntimeStorageLayout,
} from "@/composition/storage";

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  requireRuntimeAdministrator(locals.session, {
    hideExistence: true,
  });
  const layout = await getRuntimeStorageLayout();
  const environment = getRuntimeEnvironment();
  const worker = await readWorkerHealthSnapshot(
    resolve(layout.temporaryDirectory, "worker-health.json"),
  );
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
        active_jobs: worker?.lease.activeJobs ?? null,
        earliest_expiry: worker?.lease.earliestExpiry ?? null,
      },
      metrics: operationalMetrics.snapshot(),
      wal_bytes: walBytes,
      worker,
    },
    { headers },
  );
};
