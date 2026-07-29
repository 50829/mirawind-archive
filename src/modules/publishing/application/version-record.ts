export type BookVersionState =
  "corrupt" | "failed" | "published" | "ready" | "superseded";

export interface BookVersionRecord {
  readonly bookId: number;
  readonly compilerVersion: string;
  readonly completeAtMs: number;
  readonly configRevision: number;
  readonly createdByJobId: string;
  readonly id: string;
  readonly manifestSchemaVersion: number;
  readonly manifestSha256: string;
  readonly predecessorVersionId: string | null;
  readonly publishedAtMs: number | null;
  readonly reclaimedAtMs: number | null;
  readonly rendererVersion: string;
  readonly sourceId: string;
  readonly state: BookVersionState;
  readonly verifiedAtMs: number | null;
  readonly versionRelativePath: string;
}
