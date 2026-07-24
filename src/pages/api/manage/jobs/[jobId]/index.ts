import type { APIRoute } from "astro";

import { JobRepository } from "@/db/repositories/jobs";
import { SafeApplicationError } from "@/domain/errors";
import { isOpaqueId } from "@/domain/ids";
import { requireRuntimeAdministrator } from "@/http/authorization/runtime-admin";
import { applyResponsePolicy } from "@/http/cache/policies";
import { serializeJobStatus } from "@/services/job-status";

export const prerender = false;

export const GET: APIRoute = ({ locals, params }) => {
  const { database } = requireRuntimeAdministrator(locals.session, {
    hideExistence: true,
  });
  const jobId = params.jobId;
  if (!jobId || !isOpaqueId("job", jobId)) {
    throw new SafeApplicationError(
      "JOB_NOT_FOUND",
      "The job was not found.",
      404,
    );
  }
  const job = new JobRepository(database).get(jobId);
  if (!job) {
    throw new SafeApplicationError(
      "JOB_NOT_FOUND",
      "The job was not found.",
      404,
    );
  }
  const headers = new Headers();
  applyResponsePolicy(headers, "private-api");
  return Response.json(serializeJobStatus(job), { headers });
};
