export interface BookVersionPresentation {
  readonly alias: string | null;
  readonly bookId: number;
  readonly configRevision: number;
  readonly coverResourceId: string | null;
  readonly createdAtMs: number;
  readonly firstPageAlias: string | null;
  readonly firstPageId: number;
  readonly metadataJson: string;
  readonly projectionSchemaVersion: 1;
  readonly projectionSha256: string;
  readonly title: string;
  readonly tocEntryCount: number;
  readonly tocPreviewJson: string;
  readonly versionId: string;
}
