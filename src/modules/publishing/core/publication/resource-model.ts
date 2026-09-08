import type { SafeDiagnostic } from "@/domain/errors";

export interface ResolvedResource {
  readonly absolutePath: string;
  readonly id: string;
  readonly originalUrl: string;
  readonly relativePath: string;
}

export interface ResourceReference {
  readonly originalUrl: string;
  readonly resourceId: string;
}

export interface ResourceResolution {
  readonly diagnostics: readonly SafeDiagnostic[];
  readonly references: readonly ResourceReference[];
  readonly resources: readonly ResolvedResource[];
}
