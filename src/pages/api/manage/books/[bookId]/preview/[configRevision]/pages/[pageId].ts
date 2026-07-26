import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { APIRoute } from "astro";

import { DraftRepository } from "@/db/repositories/drafts";
import { SafeApplicationError } from "@/domain/errors";
import { authorizePreviewHtmlResources } from "@/http/authorization/preview-resource";
import { requireRuntimeAdministrator } from "@/http/authorization/runtime-admin";
import { applyResponsePolicy } from "@/http/cache/policies";
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
  const { database, session } = requireRuntimeAdministrator(locals.session, {
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
  const drafts = new DraftRepository(database);
  const book = drafts.findBook(bookId);
  const preview = drafts.findPreview(bookId, revision);
  if (
    !session ||
    book?.draftConfigRevision !== revision ||
    book.readyPreviewRevision !== revision ||
    preview?.state !== "ready" ||
    !preview.previewRelativePath
  ) {
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
  html = authorizePreviewHtmlResources({
    authSecret: getRuntimeEnvironment().authSecret,
    bookId,
    html,
    nowMs: Date.now(),
    revision,
    session,
  });
  const publicOrigin = getRuntimeEnvironment().publicOrigin;
  const headers = new Headers({
    "Content-Security-Policy": [
      "default-src 'none'",
      "base-uri 'none'",
      `font-src ${publicOrigin} data:`,
      "form-action 'none'",
      `frame-ancestors ${publicOrigin}`,
      `img-src ${publicOrigin} data:`,
      "object-src 'none'",
      `script-src ${publicOrigin}`,
      `style-src ${publicOrigin} 'unsafe-inline'`,
    ].join("; "),
    "Content-Type": "text/html; charset=utf-8",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  applyResponsePolicy(headers, "draft");
  return new Response(html, { headers });
};
