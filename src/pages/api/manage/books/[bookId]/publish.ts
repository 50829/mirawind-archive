import type { APIRoute } from "astro";

import { createPublishingServer } from "@/composition/server";
import { SafeApplicationError } from "@/domain/errors";
import { isOpaqueId } from "@/domain/ids";
import { requireRuntimeAdministrator } from "@/http/authorization/runtime-admin";
import { applyResponsePolicy } from "@/http/cache/policies";
import { readBoundedJson } from "@/http/json-body";
import { requireMutationOrigin } from "@/http/origin";
import { getRuntimeEnvironment } from "@/composition/storage";

export const prerender = false;

function bookId(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

export const POST: APIRoute = async ({ locals, params, request }) => {
  const { database, session } = requireRuntimeAdministrator(locals.session);
  requireMutationOrigin(request, getRuntimeEnvironment().publicOrigin);
  const id = bookId(params.bookId);
  if (!id) {
    throw new SafeApplicationError("NOT_FOUND", "The book was not found.", 404);
  }
  const body = await readBoundedJson(request, 64 * 1024);
  const record = body as Record<string, unknown>;
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).sort().join(",") !==
      "expected_candidate_version_id,expected_config_revision" ||
    !Number.isSafeInteger(record.expected_config_revision) ||
    Number(record.expected_config_revision) < 1 ||
    typeof record.expected_candidate_version_id !== "string" ||
    !isOpaqueId("version", record.expected_candidate_version_id)
  ) {
    throw new SafeApplicationError(
      "REQUEST_BODY_INVALID",
      "A valid candidate identity and revision are required.",
      400,
    );
  }
  const publishing = createPublishingServer(database);
  const published = await publishing.publishCandidate({
    actorUserId: session?.user.id ?? null,
    bookId: id,
    expectedConfigRevision: Number(record.expected_config_revision),
    expectedVersionId: record.expected_candidate_version_id,
    nowMs: Date.now(),
  });
  const headers = new Headers();
  applyResponsePolicy(headers, "private-api");
  return Response.json(
    {
      published_at: published.publishedAtMs,
      state: published.state,
      version_id: published.versionId,
    },
    { headers, status: 200 },
  );
};
