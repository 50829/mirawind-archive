import type { APIRoute } from "astro";

import { createPublishingServer } from "@/composition/server";
import { SafeApplicationError } from "@/domain/errors";
import { isOpaqueId } from "@/domain/ids";
import { requireRuntimeAdministrator } from "@/http/authorization/runtime-admin";
import { applyResponsePolicy } from "@/http/cache/policies";

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
  const publishing = createPublishingServer(database);
  const job = publishing.getJob(jobId);
  if (!job) {
    throw new SafeApplicationError(
      "JOB_NOT_FOUND",
      "The job was not found.",
      404,
    );
  }
  const headers = new Headers();
  applyResponsePolicy(headers, "private-api");
  return Response.json(publishing.serializeJobStatus(job, true), { headers });
};
