import type { APIRoute } from "astro";

import { createPublishingServer } from "@/composition/server";
import { getRuntimeEnvironment } from "@/composition/storage";
import { SafeApplicationError } from "@/domain/errors";
import { isOpaqueId } from "@/domain/ids";
import { requireRuntimeAdministrator } from "@/http/authorization/runtime-admin";
import { applyResponsePolicy } from "@/http/cache/policies";
import { requireMutationOrigin } from "@/http/origin";

export const prerender = false;

export const PUT: APIRoute = async ({ locals, params, request }) => {
  const { database } = requireRuntimeAdministrator(locals.session);
  requireMutationOrigin(request, getRuntimeEnvironment().publicOrigin);
  const importId = params.importId;
  if (!importId || !isOpaqueId("import", importId)) {
    throw new SafeApplicationError(
      "IMPORT_NOT_FOUND",
      "The import was not found.",
      404,
    );
  }
  let candidateId: string | undefined;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (
      Object.keys(body).length === 1 &&
      typeof body.candidate_id === "string" &&
      isOpaqueId("importCandidate", body.candidate_id)
    ) {
      candidateId = body.candidate_id;
    }
  } catch {
    candidateId = undefined;
  }
  if (!candidateId) {
    throw new SafeApplicationError(
      "INVALID_BODY",
      "A valid candidate_id is required.",
      400,
    );
  }
  const publishing = createPublishingServer(database);
  const nowMs = Date.now();
  const job = publishing.confirmImportCandidateAndQueuePreparation({
    candidateId,
    importId,
    nowMs,
  });
  const headers = new Headers();
  applyResponsePolicy(headers, "private-api");
  return Response.json(
    { job_id: job.id, state: job.state },
    { headers, status: 202 },
  );
};
