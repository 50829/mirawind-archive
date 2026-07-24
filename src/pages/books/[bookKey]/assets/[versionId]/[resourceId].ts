import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

import type { APIRoute } from "astro";

import { SafeApplicationError } from "@/domain/errors";
import { resolveRuntimeAdministrator } from "@/http/authorization/runtime-admin";
import {
  conditionalNotModified,
  immutableAssetHeaders,
} from "@/http/cache/reading-response";
import { PublishedBookService } from "@/services/published-book";
import { resolveContainedPath } from "@/storage/layout";
import { getRuntimeStorageLayout } from "@/storage/runtime";

export const prerender = false;

export const GET: APIRoute = async ({ locals, params, request }) => {
  const { database, decision } = resolveRuntimeAdministrator(locals.session);
  const layout = await getRuntimeStorageLayout();
  const asset = await new PublishedBookService(database, layout).resolveAsset({
    administrator: decision,
    bookKey: params.bookKey ?? "",
    resourceId: params.resourceId ?? "",
    versionId: params.versionId ?? "",
  });
  const response = immutableAssetHeaders({
    mediaType: asset.mediaType,
    sha256: asset.sha256,
    sizeBytes: asset.sizeBytes,
    visibility: asset.visibility,
  });
  const notModified = conditionalNotModified(
    request,
    response.etag,
    response.headers,
  );
  if (notModified) return notModified;

  let path: string;
  try {
    path = await resolveContainedPath(layout.root, asset.resourceRelativePath);
  } catch (cause) {
    throw new SafeApplicationError(
      "BOOK_UNAVAILABLE",
      "This book is temporarily unavailable.",
      503,
      { cause },
    );
  }
  const body = Readable.toWeb(
    createReadStream(path),
  ) as ReadableStream<Uint8Array>;
  return new Response(body, { headers: response.headers });
};
