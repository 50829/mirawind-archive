import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { APIRoute } from "astro";

import { DraftRepository } from "@/db/repositories/drafts";
import { SafeApplicationError } from "@/domain/errors";
import { requireRuntimeAdministrator } from "@/http/authorization/runtime-admin";
import { applyResponsePolicy, createStrongEtag } from "@/http/cache/policies";
import { parseBookConfigYaml } from "@/schemas/book-config";
import { resolveContainedPath } from "@/storage/path-resolver";
import { getRuntimeStorageLayout } from "@/storage/runtime";

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
  const readyRevision = book.readyPreviewRevision;
  const preview = readyRevision
    ? drafts.findPreview(bookId, readyRevision)
    : null;
  let previewModel: Record<string, unknown> | null = null;
  let diagnostics: readonly string[] = [];
  if (preview?.state === "ready" && preview.previewRelativePath) {
    const previewRoot = await resolveContainedPath(
      layout.root,
      preview.previewRelativePath,
    );
    previewModel = JSON.parse(
      await readFile(resolve(previewRoot, "preview-model.json"), "utf8"),
    ) as Record<string, unknown>;
    if (preview.diagnosticsRelativePath) {
      const parsed = JSON.parse(
        await readFile(
          await resolveContainedPath(
            layout.root,
            preview.diagnosticsRelativePath,
          ),
          "utf8",
        ),
      ) as { diagnostics?: unknown };
      diagnostics = Array.isArray(parsed.diagnostics)
        ? parsed.diagnostics
            .filter((value): value is string => typeof value === "string")
            .slice(0, 10_000)
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
      config: parseBookConfigYaml(configYaml),
      config_revision: config.revision,
      diagnostics,
      preview:
        previewModel === null
          ? null
          : {
              config_revision: previewModel.config_revision,
              headings: previewModel.headings,
              is_stale: readyRevision !== book.draftConfigRevision,
              pages: previewModel.pages,
            },
      preview_state:
        preview?.state ?? (book.draftConfigRevision ? "building" : "failed"),
      source_id: book.draftSourceId,
    },
    { headers },
  );
};
