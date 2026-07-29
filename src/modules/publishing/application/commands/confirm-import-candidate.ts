import { SafeApplicationError } from "@/domain/errors";

interface ImportRecord {
  readonly bookId: number | null;
  readonly id: string;
  readonly state: string;
}

interface ImportCandidate {
  readonly id: string;
}

interface ImportConfirmationPort {
  candidates(importId: string): readonly ImportCandidate[];
  confirmCandidate(input: {
    readonly candidateId: string;
    readonly importId: string;
    readonly nowMs: number;
  }): ImportRecord;
  find(importId: string): ImportRecord | null;
}

interface PreparationJobPort<Job> {
  create(input: {
    readonly bookId?: number;
    readonly idempotency: {
      readonly key: string;
      readonly operation: string;
    };
    readonly importId: string;
    readonly kind: "prepare_draft";
    readonly nowMs: number;
  }): Job;
}

export function confirmImportCandidateAndQueuePreparation<Job>(input: {
  readonly candidateId: string;
  readonly importId: string;
  readonly imports: ImportConfirmationPort;
  readonly jobs: PreparationJobPort<Job>;
  readonly nowMs: number;
  readonly runAtomically: <Result>(operation: () => Result) => Result;
}): Job {
  return input.runAtomically(() => {
    const current = input.imports.find(input.importId);
    if (!current) {
      throw new SafeApplicationError(
        "IMPORT_NOT_FOUND",
        "The import was not found.",
        404,
      );
    }
    if (current.state !== "needs_main_confirmation") {
      throw new SafeApplicationError(
        "IMPORT_STATE_CONFLICT",
        "The import is not awaiting candidate confirmation.",
        409,
      );
    }
    if (
      !input.imports
        .candidates(input.importId)
        .some((candidate) => candidate.id === input.candidateId)
    ) {
      throw new SafeApplicationError(
        "CANDIDATE_NOT_FOUND",
        "The candidate was not found.",
        404,
      );
    }
    const imported = input.imports.confirmCandidate({
      candidateId: input.candidateId,
      importId: input.importId,
      nowMs: input.nowMs,
    });
    return input.jobs.create({
      ...(imported.bookId === null ? {} : { bookId: imported.bookId }),
      idempotency: {
        key: `prepare-import-${imported.id}`,
        operation: "import.prepare",
      },
      importId: imported.id,
      kind: "prepare_draft",
      nowMs: input.nowMs,
    });
  });
}
