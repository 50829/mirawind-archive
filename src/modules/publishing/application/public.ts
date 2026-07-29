import { parseBookConfigYaml } from "@/modules/publishing/core/publication/book-config-schema";
import {
  canonicalJson,
  compilerIdentity,
} from "@/modules/publishing/core/publication/manifest";
import { validateDocumentManifest } from "@/modules/publishing/core/publication/document-manifest-schema";
import { validateBookConfig } from "@/modules/publishing/core/publication/book-config-schema";
import {
  katexCriticalCss,
  rendererStylesheetUrl,
} from "@/modules/publishing/core/publication/render-assets";
import {
  isKnownJobPhase,
  jobKinds,
} from "@/modules/publishing/application/job-state";
import { evaluateJobRetry } from "@/modules/publishing/application/retry-policy";
import {
  importUploadIdempotencyOperation,
  m1ImportExpiryMs,
  maximumUploadBytes,
} from "@/modules/publishing/application/import-upload-policy";
import { m1PublishPolicy } from "@/modules/publishing/application/publish-policy";

export type { TypographyProfile } from "@/modules/publishing/core/preparation/document-model";
export type {
  JobKind,
  JobPhase,
} from "@/modules/publishing/application/job-state";
export type {
  BookVersionRecord,
  BookVersionState,
} from "@/modules/publishing/application/version-record";

export {
  evaluateJobRetry,
  importUploadIdempotencyOperation,
  isKnownJobPhase,
  jobKinds,
  m1ImportExpiryMs,
  m1PublishPolicy,
  maximumUploadBytes,
  canonicalJson,
  katexCriticalCss,
  parseBookConfigYaml,
  rendererStylesheetUrl,
  validateBookConfig,
  validateDocumentManifest,
};

export const publishingRendererIdentity = compilerIdentity.renderer_version;
