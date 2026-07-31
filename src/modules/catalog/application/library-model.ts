export interface PublicLibraryEntry {
  readonly authors: readonly string[];
  readonly bookId: number;
  readonly bookKey: string;
  readonly coverUrl: string | null;
  readonly detailsUrl: string;
  readonly presentationDigest: string;
  readonly startUrl: string;
  readonly title: string;
  readonly versionId: string;
}

export interface PublicLibraryView {
  readonly digest: string;
  readonly entries: readonly PublicLibraryEntry[];
  readonly hasUnavailableBooks: boolean;
}

export interface AdministratorLibraryEntry {
  readonly access: "private" | "public";
  readonly bookId: number;
  readonly currentVersionAvailable: boolean;
  readonly deletionMutationToken: string;
  readonly previewReady: boolean;
  readonly primaryHref: string;
  readonly statusLabel: string;
  readonly title: string;
}

export interface AdministratorLibraryPage {
  readonly entries: readonly AdministratorLibraryEntry[];
  readonly nextBookId: number | null;
}

export interface BookDetails extends PublicLibraryEntry {
  readonly access: "private" | "public";
  readonly contributors: readonly string[];
  readonly description: string | null;
  readonly language: string | null;
  readonly originals: readonly {
    readonly href: string;
    readonly label: string;
    readonly mediaType: string;
    readonly sizeBytes: number;
  }[];
  readonly subtitle: string | null;
  readonly toc: readonly {
    readonly href: string;
    readonly level: number;
    readonly number: string | null;
    readonly title: string;
  }[];
  readonly tocEntryCount: number;
  readonly tocTruncated: boolean;
}
