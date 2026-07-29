import type { APIRoute } from "astro";

import {
  getRuntimeEnvironment,
  getRuntimeStorageLayout,
} from "@/composition/storage";
import { requireRuntimeAdministrator } from "@/http/authorization/runtime-admin";
import { applyResponsePolicy } from "@/http/cache/policies";
import { storeMultipartImport } from "@/http/multipart/import-form";
import { requireMutationOrigin } from "@/http/origin";
import { SafeApplicationError } from "@/domain/errors";

export const prerender = false;

export const POST: APIRoute = async ({ locals, request }) => {
  const { database } = requireRuntimeAdministrator(locals.session);
  requireMutationOrigin(request, getRuntimeEnvironment().publicOrigin);
  const idempotencyKey = request.headers.get("idempotency-key");
  if (
    !idempotencyKey ||
    [...idempotencyKey].length < 16 ||
    [...idempotencyKey].length > 200
  ) {
    throw new SafeApplicationError(
      "IDEMPOTENCY_KEY_INVALID",
      "A valid Idempotency-Key header is required.",
      400,
    );
  }
  const result = await storeMultipartImport({
    database,
    idempotencyKey,
    layout: await getRuntimeStorageLayout(),
    request,
  });
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
  });
  applyResponsePolicy(headers, "private-api");
  return Response.json(
    {
      import_id: result.import.id,
      job_id: result.job.id,
      state: "uploaded",
    },
    { headers, status: 202 },
  );
};
