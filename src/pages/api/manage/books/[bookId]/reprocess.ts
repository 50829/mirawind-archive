import type { APIRoute } from "astro";

import type { TypographyProfile } from "@/compiler/document/types";
import { SafeApplicationError } from "@/domain/errors";
import { requireRuntimeAdministrator } from "@/http/authorization/runtime-admin";
import { applyResponsePolicy } from "@/http/cache/policies";
import { readBoundedJson } from "@/http/json-body";
import { requireMutationOrigin } from "@/http/origin";
import { queueSourceReprocess } from "@/services/source-reprocess";
import {
  getRuntimeEnvironment,
  getRuntimeStorageLayout,
} from "@/storage/runtime";

export const prerender = false;

function positiveInteger(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

export const POST: APIRoute = async ({ locals, params, request }) => {
  const { database } = requireRuntimeAdministrator(locals.session);
  requireMutationOrigin(request, getRuntimeEnvironment().publicOrigin);
  const bookId = positiveInteger(params.bookId);
  const body = await readBoundedJson(request, 64 * 1024);
  if (
    !bookId ||
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 2
  ) {
    throw new SafeApplicationError(
      "REQUEST_BODY_INVALID",
      "A valid reprocess request is required.",
      400,
    );
  }
  const value = body as Record<string, unknown>;
  const profile = value.profile;
  if (
    (profile !== "verbatim-v1" && profile !== "zh-smart-v1") ||
    !Number.isSafeInteger(value.expected_config_revision) ||
    Number(value.expected_config_revision) < 1
  ) {
    throw new SafeApplicationError(
      "REQUEST_BODY_INVALID",
      "A valid reprocess request is required.",
      400,
    );
  }
  const queued = await queueSourceReprocess({
    bookId,
    database,
    expectedConfigRevision: Number(value.expected_config_revision),
    layout: await getRuntimeStorageLayout(),
    nowMs: Date.now(),
    profile: profile as TypographyProfile,
  });
  const headers = new Headers();
  applyResponsePolicy(headers, "private-api");
  return Response.json(
    { job_id: queued.job.id, state: queued.job.state },
    { headers, status: 202 },
  );
};
