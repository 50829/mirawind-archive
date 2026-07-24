import type { APIRoute } from "astro";

import { getRuntimeEnvironment } from "@/storage/runtime";
import { ImportRepository } from "@/db/repositories/imports";
import { JobRepository } from "@/db/repositories/jobs";
import { withImmediateTransaction } from "@/db/transaction/immediate";
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
      isOpaqueId("candidate", body.candidate_id)
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
  const imports = new ImportRepository(database);
  const current = imports.find(importId);
  if (!current) {
    throw new SafeApplicationError(
      "IMPORT_NOT_FOUND",
      "The import was not found.",
      404,
    );
  }
  if (current.state !== "needs_main_confirmation") {
    throw new SafeApplicationError(
      "IMPORT_STATE_CONFLICT",
      "The import is not awaiting candidate confirmation.",
      409,
    );
  }
  if (
    !imports
      .candidates(importId)
      .some((candidate) => candidate.id === candidateId)
  ) {
    throw new SafeApplicationError(
      "CANDIDATE_NOT_FOUND",
      "The candidate was not found.",
      404,
    );
  }
  const nowMs = Date.now();
  const job = withImmediateTransaction(database, () => {
    const imported = imports.confirmCandidate({
      candidateId,
      importId,
      nowMs,
    });
    return new JobRepository(database).create({
      ...(imported.bookId === null ? {} : { bookId: imported.bookId }),
      idempotency: {
        key: `prepare-import-${imported.id}`,
        operation: "import.prepare",
      },
      importId: imported.id,
      kind: "prepare_draft",
      nowMs,
    });
  });
  const headers = new Headers();
  applyResponsePolicy(headers, "private-api");
  return Response.json(
    { job_id: job.id, state: job.state },
    { headers, status: 202 },
  );
};
