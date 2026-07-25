import type { APIRoute } from "astro";

import { DraftRepository } from "@/db/repositories/drafts";
import { JobRepository } from "@/db/repositories/jobs";
import { SourceRepository } from "@/db/repositories/sources";
import { withImmediateTransaction } from "@/db/transaction/immediate";
import { SafeApplicationError } from "@/domain/errors";
import { requireRuntimeAdministrator } from "@/http/authorization/runtime-admin";
import { applyResponsePolicy } from "@/http/cache/policies";
import { readBoundedJson } from "@/http/json-body";
import { requireMutationOrigin } from "@/http/origin";
import { m1PublishPolicy } from "@/policy/publish-policy";
import { assertReadyPreviewIdentity } from "@/services/preview-identity";
import {
  getRuntimeEnvironment,
  getRuntimeStorageLayout,
} from "@/storage/runtime";

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
  const drafts = new DraftRepository(database);
  const current = drafts.findBook(id);
  if (!current?.draftSourceId || !current.draftConfigRevision) {
    throw new SafeApplicationError("NOT_FOUND", "The book was not found.", 404);
  }
  const config = drafts.requireConfig(id, current.draftConfigRevision);
  const source = new SourceRepository(database).requireSnapshot(
    current.draftSourceId,
  );
  const preview =
    current.readyPreviewRevision === null
      ? null
      : drafts.findPreview(id, current.readyPreviewRevision);
  if (!preview) {
    throw new SafeApplicationError(
      "PUBLISH_PREVIEW_STALE",
      "The ready preview no longer matches the current publishing inputs.",
      409,
    );
  }
  await assertReadyPreviewIdentity({
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
  const job = withImmediateTransaction(database, () => {
    const book = drafts.requireBook(id);
    const preview =
      book.readyPreviewRevision === null
        ? null
        : drafts.findPreview(id, book.readyPreviewRevision);
    if (
      book.draftConfigRevision !== expectedRevision ||
      book.readyPreviewRevision !== expectedRevision ||
      preview?.state !== "ready" ||
      !book.draftSourceId
    ) {
      throw new SafeApplicationError(
        "PUBLISH_PREVIEW_STALE",
        "The ready preview no longer matches the current publishing inputs.",
        409,
      );
    }
    return new JobRepository(database).create({
      bookId: id,
      capturedConfigRevision: expectedRevision,
      ...(book.currentVersionId
        ? { capturedCurrentVersionId: book.currentVersionId }
        : {}),
      capturedSourceId: book.draftSourceId,
      idempotency: {
        key: idempotencyKey,
        operation: `book.publish:${id}:${expectedRevision}`,
      },
      kind: "build_publish",
      nowMs: Date.now(),
    });
  });
  const headers = new Headers();
  applyResponsePolicy(headers, "private-api");
  return Response.json(
    { job_id: job.id, state: job.state },
    { headers, status: 202 },
  );
};
