import type { APIRoute } from "astro";

import { createPublishedBookServer } from "@/composition/server";
import { resolveRuntimeAdministrator } from "@/http/authorization/runtime-admin";
import {
  conditionalNotModified,
  immutableAssetHeaders,
} from "@/http/cache/reading-response";
import { getRuntimeStorageLayout } from "@/composition/storage";

export const prerender = false;

export const GET: APIRoute = async ({ locals, params, request }) => {
  const { database, decision } = resolveRuntimeAdministrator(locals.session);
  const layout = await getRuntimeStorageLayout();
  const publishedBook = createPublishedBookServer(database, layout);
  const asset = await publishedBook.resolveAsset({
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

  return new Response(await publishedBook.readAssetBody(asset), {
    headers: response.headers,
  });
};
