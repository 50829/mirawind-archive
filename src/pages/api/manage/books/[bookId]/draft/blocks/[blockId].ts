import type { APIRoute } from "astro";

import { publishingDraftActions } from "@/composition/server/publishing-drafts";
import {
  getRuntimeEnvironment,
  getRuntimeStorageLayout,
} from "@/composition/storage";
import { SafeApplicationError } from "@/domain/errors";
import { isOpaqueId } from "@/domain/ids";
import { requireRuntimeAdministrator } from "@/http/authorization/runtime-admin";
import { applyResponsePolicy } from "@/http/cache/policies";
import { readBoundedJson } from "@/http/json-body";
import { requireMutationOrigin } from "@/http/origin";

export const prerender = false;

function identity(params: Readonly<Record<string, string | undefined>>): {
  readonly blockId: string;
  readonly bookId: number;
} {
  const bookId = Number(params.bookId);
  const blockId = params.blockId ?? "";
  if (
    !Number.isSafeInteger(bookId) ||
    bookId < 1 ||
    !isOpaqueId("block", blockId)
  ) {
    throw new SafeApplicationError(
      "NOT_FOUND",
      "The draft block was not found.",
      404,
    );
  }
  return { blockId, bookId };
}

export const GET: APIRoute = async ({ locals, params }) => {
  const { database } = requireRuntimeAdministrator(locals.session, {
    hideExistence: true,
  });
  const target = identity(params);
  const result = await publishingDraftActions.getDraftBlock({
    ...target,
    database,
    layout: await getRuntimeStorageLayout(),
  });
  const headers = new Headers({ ETag: result.etag });
  applyResponsePolicy(headers, "private-api");
  return Response.json(
    {
      block_id: result.block_id,
      config_revision: result.config_revision,
      kind: result.kind,
      markdown: result.markdown,
    },
    { headers },
  );
};

export const PATCH: APIRoute = async ({ locals, params, request }) => {
  const { database } = requireRuntimeAdministrator(locals.session);
  requireMutationOrigin(request, getRuntimeEnvironment().publicOrigin);
  const target = identity(params);
  const result = await publishingDraftActions.patchDraftBlock({
    ...target,
    database,
    expectedEtag: request.headers.get("if-match"),
    layout: await getRuntimeStorageLayout(),
    nowMs: Date.now(),
    patch: await readBoundedJson(request, 4 * 1024 * 1024),
  });
  const headers = new Headers({ ETag: result.etag });
  applyResponsePolicy(headers, "private-api");
  return Response.json(
    {
      book_id: target.bookId,
      candidate: {
        attempt_id: result.candidate.attemptId,
        job_id: result.candidate.jobId,
        state: result.candidate.state,
      },
      config_revision: result.revision,
      selected_block_id: result.selectedBlockId,
    },
    { headers, status: 202 },
  );
};
