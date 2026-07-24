import type { APIRoute } from "astro";

import { ImportRepository } from "@/db/repositories/imports";
import { JobRepository } from "@/db/repositories/jobs";
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
  const repository = new ImportRepository(database);
  const imported = repository.find(importId);
  if (!imported) {
    throw new SafeApplicationError(
      "IMPORT_NOT_FOUND",
      "The import was not found.",
      404,
    );
  }
  const headers = new Headers();
  applyResponsePolicy(headers, "private-api");
  return Response.json(
    {
      book_id: imported.bookId,
      candidates: repository.candidates(importId).map((candidate) => ({
        candidate_id: candidate.id,
        confidence: candidate.confidence,
        diagnostics: candidate.diagnostics.map((diagnostic) => diagnostic.code),
        display_path: candidate.normalizedPath,
        evidence: evidence(candidate.evidence),
      })),
      created_at: new Date(imported.createdAtMs).toISOString(),
      current_job_id:
        new JobRepository(database).latestForImport(importId)?.id ?? null,
      error_code: imported.safeErrorCode,
      import_id: imported.id,
      selected_candidate_id: imported.selectedCandidateId,
      state: imported.state,
      updated_at: new Date(imported.updatedAtMs).toISOString(),
    },
    { headers },
  );
};
