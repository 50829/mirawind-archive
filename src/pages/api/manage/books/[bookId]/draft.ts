import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { APIRoute } from "astro";

import { DraftRepository } from "@/db/repositories/drafts";
import {
  SafeApplicationError,
  createSafeDiagnostic,
  type SafeDiagnostic,
} from "@/domain/errors";
import { requireRuntimeAdministrator } from "@/http/authorization/runtime-admin";
import { applyResponsePolicy, createStrongEtag } from "@/http/cache/policies";
import { requireMutationOrigin } from "@/http/origin";
import { readBoundedJson } from "@/http/json-body";
import { parseBookConfigYaml } from "@/schemas/book-config";
import { patchDraftConfig } from "@/services/config-revisions";
import { resolveContainedPath } from "@/storage/path-resolver";
import {
  getRuntimeEnvironment,
  getRuntimeStorageLayout,
} from "@/storage/runtime";

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
  const drafts = new DraftRepository(database);
  const book = drafts.findBook(bookId);
  if (!book?.draftConfigRevision || !book.draftSourceId) {
    throw new SafeApplicationError(
      "NOT_FOUND",
      "The draft was not found.",
      404,
    );
  }
  const config = drafts.requireConfig(bookId, book.draftConfigRevision);
  const layout = await getRuntimeStorageLayout();
  const configYaml = await readFile(
    await resolveContainedPath(layout.root, config.yamlRelativePath),
    "utf8",
  );
  const configValue = parseBookConfigYaml(configYaml);
  const readyRevision = book.readyPreviewRevision;
  const readyPreview = readyRevision
    ? drafts.findPreview(bookId, readyRevision)
    : null;
  const currentPreview = drafts.findPreview(bookId, book.draftConfigRevision);
  let previewModel: Record<string, unknown> | null = null;
  let diagnostics: readonly SafeDiagnostic[] = [];
  if (
    readyRevision === book.draftConfigRevision &&
    readyPreview?.state === "ready" &&
    readyPreview.previewRelativePath
  ) {
    const previewRoot = await resolveContainedPath(
      layout.root,
      readyPreview.previewRelativePath,
    );
    previewModel = JSON.parse(
      await readFile(resolve(previewRoot, "preview-model.json"), "utf8"),
    ) as Record<string, unknown>;
    if (readyPreview.diagnosticsRelativePath) {
      const parsed = JSON.parse(
        await readFile(
          await resolveContainedPath(
            layout.root,
            readyPreview.diagnosticsRelativePath,
          ),
          "utf8",
        ),
      ) as { diagnostics?: unknown };
      diagnostics = Array.isArray(parsed.diagnostics)
        ? parsed.diagnostics
            .filter((value): value is SafeDiagnostic =>
              Boolean(
                value &&
                typeof value === "object" &&
                typeof (value as Record<string, unknown>).code === "string" &&
                typeof (value as Record<string, unknown>).message === "string",
              ),
            )
            .slice(0, 10_000)
            .map(createSafeDiagnostic)
        : [];
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
  const result = await patchDraftConfig({
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
