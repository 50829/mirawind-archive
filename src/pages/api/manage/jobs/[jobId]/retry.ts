import { createHash } from "node:crypto";

import type { APIRoute } from "astro";

import { createPublishingJobServer } from "@/composition/server/publishing-jobs";
import { SafeApplicationError } from "@/domain/errors";
import { isOpaqueId } from "@/domain/ids";
import { requireRuntimeAdministrator } from "@/http/authorization/runtime-admin";
import { applyResponsePolicy } from "@/http/cache/policies";
import { requireMutationOrigin } from "@/http/origin";
import { evaluateJobRetry } from "@/modules/publishing/application/publishing-api";
import { getRuntimeEnvironment } from "@/composition/storage";

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

function requireIdempotencyKey(request: Request): string {
  const value = request.headers.get("idempotency-key");
  if (!value || [...value].length < 16 || [...value].length > 200) {
    throw new SafeApplicationError(
      "IDEMPOTENCY_KEY_INVALID",
      "A valid Idempotency-Key header is required.",
      400,
    );
  }
  return value;
}

export const POST: APIRoute = ({ locals, params, request }) => {
  const { database } = requireRuntimeAdministrator(locals.session);
  requireMutationOrigin(request, getRuntimeEnvironment().publicOrigin);
  const jobId = requireJobId(params.jobId);
  const idempotencyKey = requireIdempotencyKey(request);
  const publishing = createPublishingJobServer(database);
  const original = publishing.getJob(jobId);
  if (!original) {
    throw new SafeApplicationError(
      "JOB_NOT_FOUND",
      "The job was not found.",
      404,
    );
  }
  const decision = evaluateJobRetry(original, "manual");
  if (!decision.allowed) {
    throw new SafeApplicationError(
      decision.reason,
      "The job is not eligible for explicit retry.",
      409,
    );
  }
  const retry = publishing.retryJob(jobId, {
    automatic: false,
    idempotency: {
      key: createHash("sha256")
        .update(jobId, "utf8")
        .update("\0")
        .update(idempotencyKey, "utf8")
        .digest("hex"),
      operation: "job.retry",
    },
    nowMs: Date.now(),
  });
  const headers = new Headers();
  applyResponsePolicy(headers, "private-api");
  return Response.json(
    { job_id: retry.id, state: retry.state },
    { headers, status: 202 },
  );
};
