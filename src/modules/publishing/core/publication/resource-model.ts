import type {
  ParsedDocument,
  SourcePosition,
} from "@/modules/publishing/core/preparation/document-model";
import type { SafeDiagnostic } from "@/domain/errors";

export interface ResolvedResource {
  readonly absolutePath: string;
  readonly id: string;
  readonly originalUrl: string;
  readonly relativePath: string;
}

export interface ResourceReference {
  readonly originalUrl: string;
  readonly position?: SourcePosition;
  readonly resourceId: string;
}

export interface ResourceResolution {
  readonly diagnostics: readonly SafeDiagnostic[];
  readonly references: readonly ResourceReference[];
  readonly resources: readonly ResolvedResource[];
}

export interface ResolveDocumentResourcesOptions {
  readonly additionalImagePaths?: readonly string[];
  readonly document: ParsedDocument;
  readonly idFactory?: () => string;
  readonly markdownPath: string;
  readonly resourceRoot: string;
}
