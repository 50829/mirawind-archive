export interface CurrentBookVersion {
  readonly bookId: number;
  readonly currentVersionId: string;
}

export interface CurrentVersionCatalogPort {
  isCurrentVersion(input: {
    readonly bookId: number;
    readonly versionId: string;
  }): boolean;
  listCurrentVersions(): readonly CurrentBookVersion[];
  markCurrentVersionUnavailable(input: {
    readonly bookId: number;
    readonly currentVersionId: string;
    readonly nowMs: number;
  }): void;
  replaceCurrentVersion(input: {
    readonly alias: string | null;
    readonly bookId: number;
    readonly currentVersionId: string;
    readonly nowMs: number;
    readonly replacementVersionId: string;
  }): void;
}
