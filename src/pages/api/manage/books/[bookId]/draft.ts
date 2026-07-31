import type { APIRoute } from "astro";

import {
  createPublishingArtifactServer,
  createPublishingServer,
  publishingServerActions,
} from "@/composition/server";
import { SafeApplicationError, type SafeDiagnostic } from "@/domain/errors";
import { requireRuntimeAdministrator } from "@/http/authorization/runtime-admin";
import { applyResponsePolicy, createStrongEtag } from "@/http/cache/policies";
import { requireMutationOrigin } from "@/http/origin";
import { readBoundedJson } from "@/http/json-body";
import { getCurrentDraftCandidate } from "@/modules/publishing/application/public";
import {
  getRuntimeEnvironment,
  getRuntimeStorageLayout,
} from "@/composition/storage";

export const prerender = false;

function positiveInteger(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

export const GET: APIRoute = async ({ locals, params }) => {
  const { database } = requireRuntimeAdministrator(locals.session, {
    hideExistence: true,
  });
  const bookId = positiveInteger(params.bookId);
  if (!bookId) {
    throw new SafeApplicationError(
      "NOT_FOUND",
      "The draft was not found.",
      404,
    );
  }
  const publishing = createPublishingServer(database);
  const book = publishing.findBook(bookId);
  if (!book?.draftConfigRevision || !book.draftSourceId) {
    throw new SafeApplicationError(
      "NOT_FOUND",
      "The draft was not found.",
      404,
    );
  }
  const config = publishing.requireConfig(bookId, book.draftConfigRevision);
  const layout = await getRuntimeStorageLayout();
  const artifacts = createPublishingArtifactServer(layout);
  const configValue = await artifacts.readBookConfig(config.yamlRelativePath);
  const candidateRecord = publishing.findCurrentCandidate(bookId);
  const candidate = getCurrentDraftCandidate({
    bookId,
    candidate: candidateRecord,
    configRevision: book.draftConfigRevision,
  });
  let previewModel: Record<string, unknown> | null = null;
  let diagnostics: readonly SafeDiagnostic[] = [];
  if (candidate?.state === "ready" && candidate.version_id !== null) {
    const previewRelativePath = `books/${bookId}/versions/${candidate.version_id}/preview`;
    previewModel = await artifacts.readPreviewModel(previewRelativePath);
    diagnostics = await artifacts.readDiagnostics(
      `${previewRelativePath}/diagnostics.json`,
    );
  }
  const headers = new Headers({
    ETag: createStrongEtag(config.yamlSha256),
  });
  applyResponsePolicy(headers, "draft");
  return Response.json(
    {
      book_id: book.id,
      candidate,
      alias: configValue.alias ?? null,
      boundaries: configValue.boundaries,
      config_revision: config.revision,
      diagnostics,
      metadata: configValue.metadata,
      preview:
        previewModel === null
          ? null
          : {
              compiler_version: previewModel.compiler_version,
              boundaries: previewModel.boundaries,
              content_cleanup: previewModel.content_cleanup,
              config_sha256: previewModel.config_sha256,
              config_revision: previewModel.config_revision,
              headings: previewModel.headings,
              is_stale: false,
              pages: previewModel.pages,
              renderer_version: previewModel.renderer_version,
              semantic_digest: previewModel.semantic_digest,
              source_sha256: previewModel.source_sha256,
              typography: previewModel.typography,
            },
      structure: configValue.structure,
      title: (configValue.metadata as Record<string, unknown>).title,
    },
    { headers },
  );
};

export const PATCH: APIRoute = async ({ locals, params, request }) => {
  const { database } = requireRuntimeAdministrator(locals.session);
  requireMutationOrigin(request, getRuntimeEnvironment().publicOrigin);
  const bookId = positiveInteger(params.bookId);
  if (!bookId) {
    throw new SafeApplicationError(
      "NOT_FOUND",
      "The draft was not found.",
      404,
    );
  }
  const result = await publishingServerActions.patchDraftConfig({
    bookId,
    database,
    expectedEtag: request.headers.get("if-match"),
    layout: await getRuntimeStorageLayout(),
    nowMs: Date.now(),
    patch: await readBoundedJson(request),
  });
  const headers = new Headers({ ETag: result.etag });
  applyResponsePolicy(headers, "private-api");
  return Response.json(
    {
      book_id: bookId,
      candidate: {
        attempt_id: result.candidate.attemptId,
        job_id: result.candidate.jobId,
        state: result.candidate.state,
      },
      config_revision: result.revision,
    },
    { headers, status: 202 },
  );
};
