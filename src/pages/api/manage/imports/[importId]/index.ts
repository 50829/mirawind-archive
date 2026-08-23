import type { APIRoute } from "astro";

import { createPublishingImportServer } from "@/composition/server/publishing-imports";
import { createPublishingDraftServer } from "@/composition/server/publishing-drafts";
import { createPublishingJobServer } from "@/composition/server/publishing-jobs";
import { SafeApplicationError } from "@/domain/errors";
import { isOpaqueId } from "@/domain/ids";
import { requireRuntimeAdministrator } from "@/http/authorization/runtime-admin";
import { applyResponsePolicy } from "@/http/cache/policies";

export const prerender = false;

function evidence(value: Readonly<Record<string, unknown>>): readonly string[] {
  const output: string[] = [];
  if (typeof value.firstHeading === "string") {
    output.push(`First heading: ${value.firstHeading.slice(0, 450)}`);
  }
  if (typeof value.byteSize === "number") {
    output.push(`Markdown bytes: ${value.byteSize}`);
  }
  if (typeof value.referencedResources === "number") {
    output.push(`Referenced resources: ${value.referencedResources}`);
  }
  return output;
}

export const GET: APIRoute = ({ locals, params }) => {
  const { database } = requireRuntimeAdministrator(locals.session, {
    hideExistence: true,
  });
  const importId = params.importId;
  if (!importId || !isOpaqueId("import", importId)) {
    throw new SafeApplicationError(
      "IMPORT_NOT_FOUND",
      "The import was not found.",
      404,
    );
  }
  const publishing = createPublishingImportServer(database);
  const drafts = createPublishingDraftServer(database);
  const jobs = createPublishingJobServer(database);
  const snapshot = database
    .transaction(() => {
      const imported = publishing.findImport(importId);
      if (!imported) return null;
      const currentJob = publishing.latestJobForImport(importId);
      const book = imported.bookId ? drafts.findBook(imported.bookId) : null;
      const revision = book?.draftConfigRevision ?? null;
      const candidate = book ? drafts.findCurrentCandidate(book.id) : null;
      const previewReady =
        candidate?.state === "ready" &&
        candidate.configRevision === revision &&
        revision !== null;
      return {
        book_id: imported.bookId,
        candidates: publishing.importCandidates(importId).map((candidate) => ({
          candidate_id: candidate.id,
          confidence: candidate.confidence,
          diagnostics: candidate.diagnostics.map(
            (diagnostic) => diagnostic.code,
          ),
          display_path: candidate.normalizedPath,
          evidence: evidence(candidate.evidence),
        })),
        created_at: new Date(imported.createdAtMs).toISOString(),
        current_job: currentJob ? jobs.serializeJobStatus(currentJob) : null,
        error_code: imported.safeErrorCode,
        import_id: imported.id,
        source_name: imported.originalName,
        preview: {
          revision,
          state:
            candidate?.state ??
            (revision === null ? "unavailable" : "building"),
          url:
            previewReady && imported.bookId
              ? `/manage/books/${imported.bookId}`
              : null,
        },
        selected_candidate_id: imported.selectedCandidateId,
        state: imported.state,
        updated_at: new Date(imported.updatedAtMs).toISOString(),
      };
    })
    .deferred();
  if (!snapshot) {
    throw new SafeApplicationError(
      "IMPORT_NOT_FOUND",
      "The import was not found.",
      404,
    );
  }
  const headers = new Headers();
  applyResponsePolicy(headers, "private-api");
  return Response.json(snapshot, { headers });
};
