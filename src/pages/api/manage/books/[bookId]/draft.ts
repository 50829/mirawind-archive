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
  const readyRevision = book.readyPreviewRevision;
  const readyPreview = readyRevision
    ? publishing.findPreview(bookId, readyRevision)
    : null;
  const currentPreview = publishing.findPreview(
    bookId,
    book.draftConfigRevision,
  );
  let previewModel: Record<string, unknown> | null = null;
  let diagnostics: readonly SafeDiagnostic[] = [];
  if (
    readyRevision === book.draftConfigRevision &&
    readyPreview?.state === "ready" &&
    readyPreview.previewRelativePath
  ) {
    previewModel = await artifacts.readPreviewModel(
      readyPreview.previewRelativePath,
    );
    if (readyPreview.diagnosticsRelativePath) {
      diagnostics = await artifacts.readDiagnostics(
        readyPreview.diagnosticsRelativePath,
      );
    }
  }
  const headers = new Headers({
    ETag: createStrongEtag(config.yamlSha256),
  });
  applyResponsePolicy(headers, "draft");
  return Response.json(
    {
      book_id: book.id,
      config_revision: config.revision,
      diagnostics,
      regions: (
        configValue.source_regions as readonly {
          readonly applied: boolean;
          readonly entries: readonly unknown[];
          readonly region_id: string;
        }[]
      ).map((region) => ({
        applied: region.applied,
        block_id:
          (
            region.entries as readonly {
              readonly body_heading_block_id?: string;
            }[]
          ).find((entry) => entry.body_heading_block_id)
            ?.body_heading_block_id ?? null,
        entry_count: region.entries.length,
        region_id: region.region_id,
      })),
      preview:
        previewModel === null
          ? null
          : {
              compiler_version: previewModel.compiler_version,
              config_sha256: previewModel.config_sha256,
              config_revision: previewModel.config_revision,
              headings: previewModel.headings,
              is_stale: readyRevision !== book.draftConfigRevision,
              pages: previewModel.pages,
              renderer_version: previewModel.renderer_version,
              semantic_digest: previewModel.semantic_digest,
              source_regions: previewModel.source_regions,
              source_sha256: previewModel.source_sha256,
              typography: previewModel.typography,
            },
      preview_state:
        currentPreview?.state ??
        (book.draftConfigRevision ? "building" : "failed"),
      structure: configValue.structure,
      title: book.title,
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
      config_revision: result.revision,
      job_id: result.jobId,
      preview_state: "building",
    },
    { headers, status: 202 },
  );
};
