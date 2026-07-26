import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { APIRoute } from "astro";

import { DraftRepository } from "@/db/repositories/drafts";
import { SafeApplicationError } from "@/domain/errors";
import { isOpaqueId } from "@/domain/ids";
import { authorizePreviewResource } from "@/http/authorization/preview-resource";
import { applyResponsePolicy } from "@/http/cache/policies";
import { resolveContainedPath } from "@/storage/path-resolver";
import {
  getRuntimeEnvironment,
  getRuntimeStorageLayout,
} from "@/storage/runtime";
import { getRuntimeDatabase } from "@/auth/session";

export const prerender = false;

function positiveInteger(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

function mediaType(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  const prefix = Buffer.from(bytes.subarray(0, 12)).toString("ascii");
  if (prefix.startsWith("GIF87a") || prefix.startsWith("GIF89a")) {
    return "image/gif";
  }
  if (prefix.startsWith("RIFF") && prefix.slice(8, 12) === "WEBP") {
    return "image/webp";
  }
  return "application/octet-stream";
}

export const GET: APIRoute = async ({ params, request }) => {
  const database = getRuntimeDatabase();
  const bookId = positiveInteger(params.bookId);
  const revision = positiveInteger(params.configRevision);
  const resourceId = params.resourceId;
  if (
    !bookId ||
    !revision ||
    !resourceId ||
    !isOpaqueId("resource", resourceId)
  ) {
    throw new SafeApplicationError(
      "NOT_FOUND",
      "The asset was not found.",
      404,
    );
  }
  const drafts = new DraftRepository(database);
  const book = drafts.findBook(bookId);
  const preview = drafts.findPreview(bookId, revision);
  if (
    book?.draftConfigRevision !== revision ||
    book.readyPreviewRevision !== revision ||
    preview?.state !== "ready" ||
    !preview.previewRelativePath ||
    !authorizePreviewResource({
      authorization: new URL(request.url).searchParams.get("authorization"),
      authSecret: getRuntimeEnvironment().authSecret,
      bookId,
      database,
      nowMs: Date.now(),
      resourceId,
      revision,
    })
  ) {
    throw new SafeApplicationError(
      "NOT_FOUND",
      "The asset was not found.",
      404,
    );
  }
  const layout = await getRuntimeStorageLayout();
  const previewRoot = await resolveContainedPath(
    layout.root,
    preview.previewRelativePath,
  );
  let bytes: Uint8Array;
  try {
    bytes = await readFile(resolve(previewRoot, "assets", resourceId));
  } catch {
    throw new SafeApplicationError(
      "NOT_FOUND",
      "The asset was not found.",
      404,
    );
  }
  const headers = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Content-Type": mediaType(bytes),
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  applyResponsePolicy(headers, "draft");
  return new Response(Uint8Array.from(bytes).buffer, { headers });
};
