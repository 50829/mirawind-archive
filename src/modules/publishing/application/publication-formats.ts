import {
  parseBookConfigYaml,
  validateBookConfig,
} from "@/modules/publishing/core/publication/book-config-schema";
import { validateDocumentManifest } from "@/modules/publishing/core/publication/document-manifest-schema";
import {
  canonicalJson,
  compilerIdentity,
} from "@/modules/publishing/core/publication/manifest";
import {
  katexCriticalCss,
  rendererStylesheetUrl,
} from "@/modules/publishing/core/publication/render-assets";

export type { TypographyProfile } from "@/modules/publishing/core/preparation/document-model";
export type { HeadingNumberingMode } from "@/modules/publishing/core/publication/heading-presentation";
export type {
  BookVersionRecord,
  BookVersionState,
} from "@/modules/publishing/application/version-record";

export {
  canonicalJson,
  katexCriticalCss,
  parseBookConfigYaml,
  rendererStylesheetUrl,
  validateBookConfig,
  validateDocumentManifest,
};

export const publishingRendererIdentity = compilerIdentity.renderer_version;
