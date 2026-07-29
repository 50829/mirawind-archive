import { SafeApplicationError } from "@/domain/errors";

interface PublishBook {
  readonly currentVersionId: string | null;
  readonly draftConfigRevision: number | null;
  readonly draftSourceId: string | null;
  readonly readyPreviewRevision: number | null;
}

interface PublishPreview {
  readonly state: string;
}

interface PublishDraftPort {
  findPreview(bookId: number, revision: number): PublishPreview | null;
  requireBook(bookId: number): PublishBook;
}

interface PublishJobPort<Job> {
  create(input: {
    readonly bookId: number;
    readonly capturedConfigRevision: number;
    readonly capturedCurrentVersionId?: string;
    readonly capturedSourceId: string;
    readonly idempotency: {
      readonly key: string;
      readonly operation: string;
    };
    readonly kind: "build_publish";
    readonly nowMs: number;
  }): Job;
}

export function queuePublishBuild<Job>(input: {
  readonly bookId: number;
  readonly drafts: PublishDraftPort;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
  readonly jobs: PublishJobPort<Job>;
  readonly nowMs: number;
  readonly runAtomically: <Result>(operation: () => Result) => Result;
}): Job {
  return input.runAtomically(() => {
    const book = input.drafts.requireBook(input.bookId);
    const preview =
      book.readyPreviewRevision === null
        ? null
        : input.drafts.findPreview(input.bookId, book.readyPreviewRevision);
    if (
      book.draftConfigRevision !== input.expectedRevision ||
      book.readyPreviewRevision !== input.expectedRevision ||
      preview?.state !== "ready" ||
      !book.draftSourceId
    ) {
      throw new SafeApplicationError(
        "PUBLISH_PREVIEW_STALE",
        "The ready preview no longer matches the current publishing inputs.",
        409,
      );
    }
    return input.jobs.create({
      bookId: input.bookId,
      capturedConfigRevision: input.expectedRevision,
      ...(book.currentVersionId
        ? { capturedCurrentVersionId: book.currentVersionId }
        : {}),
      capturedSourceId: book.draftSourceId,
      idempotency: {
        key: input.idempotencyKey,
        operation: `book.publish:${input.bookId}:${input.expectedRevision}`,
      },
      kind: "build_publish",
      nowMs: input.nowMs,
    });
  });
}
