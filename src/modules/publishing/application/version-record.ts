export type BookVersionState =
  "corrupt" | "discarded" | "published" | "ready" | "superseded";

export interface BookVersionRecord {
  readonly bookId: number;
  readonly blockingDiagnosticCount: number;
  readonly compilerVersion: string;
  readonly completeAtMs: number;
  readonly sourceUpdatedAt: number;
  readonly createdByJobId: string;
  readonly id: string;
  readonly manifestSchemaVersion: number;
  readonly manifestSha256: string;
  readonly previewVersion: string;
  readonly predecessorVersionId: string | null;
  readonly publishedAtMs: number | null;
  readonly reclaimedAtMs: number | null;
  readonly rendererVersion: string;
  readonly readerVersion: string;
  readonly semanticDigest: string;
  readonly importId: string;
  readonly state: BookVersionState;
  readonly verifiedAtMs: number | null;
  readonly versionRelativePath: string;
  readonly versionMarkerSha256: string;
}
