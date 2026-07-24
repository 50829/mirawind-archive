import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { APIRoute } from "astro";

import { DraftRepository } from "@/db/repositories/drafts";
import { SafeApplicationError } from "@/domain/errors";
import { requireRuntimeAdministrator } from "@/http/authorization/runtime-admin";
import { applyResponsePolicy } from "@/http/cache/policies";
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
  const revision = positiveInteger(params.configRevision);
  const pageId = positiveInteger(params.pageId);
  if (!bookId || !revision || !pageId) {
    throw new SafeApplicationError(
      "NOT_FOUND",
      "The preview was not found.",
      404,
    );
  }
  const preview = new DraftRepository(database).findPreview(bookId, revision);
  if (preview?.state !== "ready" || !preview.previewRelativePath) {
    throw new SafeApplicationError(
      "NOT_FOUND",
      "The preview was not found.",
      404,
    );
  }
  const layout = await getRuntimeStorageLayout();
  const previewRoot = await resolveContainedPath(
    layout.root,
    preview.previewRelativePath,
  );
  let html: string;
  try {
    html = await readFile(
      resolve(previewRoot, "pages", `${pageId}.html`),
      "utf8",
    );
  } catch {
    throw new SafeApplicationError(
      "NOT_FOUND",
      "The preview was not found.",
      404,
    );
  }
  const headers = new Headers({ "Content-Type": "text/html; charset=utf-8" });
  applyResponsePolicy(headers, "draft");
  return new Response(html, { headers });
};
