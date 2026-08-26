import type { APIRoute } from "astro";

import {
  createPublishingArtifactServer,
  createPublishingDraftServer,
} from "@/composition/server/publishing-drafts";
import { SafeApplicationError } from "@/domain/errors";
import { isOpaqueId } from "@/domain/ids";
import { authorizePreviewResource } from "@/http/authorization/preview-resource";
import { applyResponsePolicy } from "@/http/cache/policies";
import {
  getRuntimeEnvironment,
  getRuntimeStorageLayout,
} from "@/composition/storage";
import { getRuntimeDatabase } from "@/composition/auth";

export const prerender = false;

function positiveInteger(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
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
  const publishing = createPublishingDraftServer(database);
  const book = publishing.findBook(bookId);
  const candidate = publishing.findCurrentCandidate(bookId);
  if (
    book?.draftConfigRevision !== revision ||
    candidate?.configRevision !== revision ||
    candidate.state !== "ready" ||
    !candidate.versionId ||
    !authorizePreviewResource({
      allowLocalDevelopmentSession:
        getRuntimeEnvironment().localDevelopmentTrust === true,
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
  const resource = await createPublishingArtifactServer(
    layout,
  ).readPreviewResource({
    bookId,
    resourceId,
    versionId: candidate.versionId,
    versionRelativePath: `books/${bookId}/versions/${candidate.versionId}`,
  });
  const headers = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Content-Type": resource.mediaType,
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  applyResponsePolicy(headers, "draft");
  return new Response(resource.body, { headers });
};
