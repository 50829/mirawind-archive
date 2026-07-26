import type { APIRoute } from "astro";

import { DraftRepository } from "@/db/repositories/drafts";
import { ImportRepository } from "@/db/repositories/imports";
import { JobRepository } from "@/db/repositories/jobs";
import { SafeApplicationError } from "@/domain/errors";
import { isOpaqueId } from "@/domain/ids";
import { requireRuntimeAdministrator } from "@/http/authorization/runtime-admin";
import { applyResponsePolicy } from "@/http/cache/policies";
import { serializeJobStatus } from "@/services/job-status";

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
  const snapshot = database
    .transaction(() => {
      const repository = new ImportRepository(database);
      const imported = repository.find(importId);
      if (!imported) return null;
      const currentJob = new JobRepository(database).latestForImport(importId);
      const drafts = new DraftRepository(database);
      const book = imported.bookId ? drafts.findBook(imported.bookId) : null;
      const revision = book?.draftConfigRevision ?? null;
      const preview =
        book && revision ? drafts.findPreview(book.id, revision) : null;
      const previewReady =
        preview?.state === "ready" &&
        book?.readyPreviewRevision === revision &&
        revision !== null;
      return {
        book_id: imported.bookId,
        candidates: repository.candidates(importId).map((candidate) => ({
          candidate_id: candidate.id,
          confidence: candidate.confidence,
          diagnostics: candidate.diagnostics.map(
            (diagnostic) => diagnostic.code,
          ),
          display_path: candidate.normalizedPath,
          evidence: evidence(candidate.evidence),
        })),
        created_at: new Date(imported.createdAtMs).toISOString(),
        current_job: currentJob ? serializeJobStatus(currentJob) : null,
        error_code: imported.safeErrorCode,
        import_id: imported.id,
        preview: {
          revision,
          state:
            preview?.state ?? (revision === null ? "unavailable" : "building"),
          url:
            previewReady && imported.bookId
              ? `/manage/books/${imported.bookId}/preview`
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
