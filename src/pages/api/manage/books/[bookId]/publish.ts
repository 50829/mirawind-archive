import type { APIRoute } from "astro";

import {
  createPublishingServer,
  publishingServerActions,
} from "@/composition/server";
import { SafeApplicationError } from "@/domain/errors";
import { requireRuntimeAdministrator } from "@/http/authorization/runtime-admin";
import { applyResponsePolicy } from "@/http/cache/policies";
import { readBoundedJson } from "@/http/json-body";
import { requireMutationOrigin } from "@/http/origin";
import { m1PublishPolicy } from "@/modules/publishing/application/public";
import {
  getRuntimeEnvironment,
  getRuntimeStorageLayout,
} from "@/composition/storage";

export const prerender = false;

function bookId(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

export const POST: APIRoute = async ({ locals, params, request }) => {
  const { database } = requireRuntimeAdministrator(locals.session);
  requireMutationOrigin(request, getRuntimeEnvironment().publicOrigin);
  const id = bookId(params.bookId);
  if (!id) {
    throw new SafeApplicationError("NOT_FOUND", "The book was not found.", 404);
  }
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
  const body = await readBoundedJson(request, 64 * 1024);
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !Number.isSafeInteger(
      (body as Record<string, unknown>).expected_config_revision,
    ) ||
    Number((body as Record<string, unknown>).expected_config_revision) < 1
  ) {
    throw new SafeApplicationError(
      "REQUEST_BODY_INVALID",
      "A valid expected_config_revision is required.",
      400,
    );
  }
  const expectedRevision = Number(
    (body as Record<string, unknown>).expected_config_revision,
  );
  const publishing = createPublishingServer(database);
  const current = publishing.findBook(id);
  if (!current?.draftSourceId || !current.draftConfigRevision) {
    throw new SafeApplicationError("NOT_FOUND", "The book was not found.", 404);
  }
  const config = publishing.requireConfig(id, current.draftConfigRevision);
  const source = publishing.requireSource(current.draftSourceId);
  const preview =
    current.readyPreviewRevision === null
      ? null
      : publishing.findPreview(id, current.readyPreviewRevision);
  if (!preview) {
    throw new SafeApplicationError(
      "PUBLISH_PREVIEW_STALE",
      "The ready preview no longer matches the current publishing inputs.",
      409,
    );
  }
  await publishingServerActions.assertReadyPreviewIdentity({
    book: current,
    config,
    layout: await getRuntimeStorageLayout(),
    preview,
    source,
  });
  const policy = await m1PublishPolicy.evaluate({
    bookId: id,
    configRevision: expectedRevision,
    sourceId: current.draftSourceId,
  });
  if (!policy.allowed) {
    throw new SafeApplicationError(
      policy.code,
      "Publication is not allowed by policy.",
      403,
    );
  }
  const job = publishing.queuePublishBuild({
    bookId: id,
    expectedRevision,
    idempotencyKey,
    nowMs: Date.now(),
  });
  const headers = new Headers();
  applyResponsePolicy(headers, "private-api");
  return Response.json(
    { job_id: job.id, state: job.state },
    { headers, status: 202 },
  );
};
