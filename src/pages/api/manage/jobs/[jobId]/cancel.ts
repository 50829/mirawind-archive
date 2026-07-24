import type { APIRoute } from "astro";

import { JobRepository } from "@/db/repositories/jobs";
import { SafeApplicationError } from "@/domain/errors";
import { isOpaqueId } from "@/domain/ids";
import { requireRuntimeAdministrator } from "@/http/authorization/runtime-admin";
import { applyResponsePolicy } from "@/http/cache/policies";
import { requireMutationOrigin } from "@/http/origin";
import { serializeJobStatus } from "@/services/job-status";
import { getRuntimeEnvironment } from "@/storage/runtime";

export const prerender = false;

function requireJobId(value: string | undefined): string {
  if (!value || !isOpaqueId("job", value)) {
    throw new SafeApplicationError(
      "JOB_NOT_FOUND",
      "The job was not found.",
      404,
    );
  }
  return value;
}

export const POST: APIRoute = ({ locals, params, request }) => {
  const { database } = requireRuntimeAdministrator(locals.session);
  requireMutationOrigin(request, getRuntimeEnvironment().publicOrigin);
  const jobId = requireJobId(params.jobId);
  const repository = new JobRepository(database);
  if (!repository.get(jobId)) {
    throw new SafeApplicationError(
      "JOB_NOT_FOUND",
      "The job was not found.",
      404,
    );
  }

  let job;
  try {
    job = repository.requestCancellation(jobId, Date.now());
  } catch (error) {
    if (error instanceof Error && error.message === "JOB_ALREADY_TERMINAL") {
      throw new SafeApplicationError(
        "JOB_ALREADY_TERMINAL",
        "The job has already reached a terminal state.",
        409,
      );
    }
    throw error;
  }

  const headers = new Headers();
  applyResponsePolicy(headers, "private-api");
  return Response.json(serializeJobStatus(job), { headers, status: 202 });
};
