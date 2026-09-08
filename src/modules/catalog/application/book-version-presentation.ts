export interface BookVersionPresentation {
  readonly alias: string | null;
  readonly bookId: number;
  readonly sourceUpdatedAt: number;
  readonly coverResourceId: string | null;
  readonly createdAtMs: number;
  readonly firstPageAlias: string | null;
  readonly firstPageId: number;
  readonly metadataJson: string;
  readonly projectionSchemaVersion: 3;
  readonly projectionSha256: string;
  readonly title: string;
  readonly tocEntryCount: number;
  readonly tocPreviewJson: string;
  readonly versionId: string;
}

export interface BookVersionPresentationWriter {
  insert(presentation: BookVersionPresentation): BookVersionPresentation;
}

export interface BookVersionPresentationRemover {
  delete(versionId: string): boolean;
}

export interface BookVersionPresentationReconciliationStore extends BookVersionPresentationWriter {
  find(versionId: string): BookVersionPresentation | null;
  repairCurrentAliases(input: {
    readonly excludedVersionIds: readonly string[];
    readonly nowMs: number;
  }): readonly number[];
}
