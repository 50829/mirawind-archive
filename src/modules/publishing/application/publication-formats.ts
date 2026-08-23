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
export {
  canonicalJson,
  katexCriticalCss,
  parseBookConfigYaml,
  rendererStylesheetUrl,
  validateBookConfig,
  validateDocumentManifest,
};

export const publishingRendererIdentity = compilerIdentity.renderer_version;

export const publishingReaderRendererAssets = Object.freeze({
  criticalCss: katexCriticalCss,
  identity: publishingRendererIdentity,
  stylesheetUrl: rendererStylesheetUrl,
});

export interface ReaderManifestPageProjection {
  readonly alias?: string;
  readonly output_path: string;
  readonly page_id: number;
  readonly title: string;
}

export interface ReaderManifestResourceProjection {
  readonly media_type: string;
  readonly output_path: string;
  readonly sha256: string;
  readonly size: number;
}

export interface ReaderManifestProjection {
  readonly book_id: number;
  readonly pages: readonly ReaderManifestPageProjection[];
  readonly resources: Readonly<
    Record<string, ReaderManifestResourceProjection>
  >;
  readonly version_id: string;
}

export function parseReaderManifestProjection(
  value: unknown,
): ReaderManifestProjection {
  const manifest = validateDocumentManifest(value);
  const pages = (
    manifest.pages as readonly Readonly<Record<string, unknown>>[]
  ).map((page) =>
    Object.freeze({
      ...(typeof page.alias === "string" ? { alias: page.alias } : {}),
      output_path: String(page.output_path),
      page_id: Number(page.page_id),
      title: String(page.title),
    }),
  );
  const resources = Object.fromEntries(
    Object.entries(
      manifest.resources as Readonly<
        Record<string, Readonly<Record<string, unknown>>>
      >,
    ).map(([id, resource]) => [
      id,
      Object.freeze({
        media_type: String(resource.media_type),
        output_path: String(resource.output_path),
        sha256: String(resource.sha256),
        size: Number(resource.size),
      }),
    ]),
  );
  return Object.freeze({
    book_id: Number(manifest.book_id),
    pages: Object.freeze(pages),
    resources: Object.freeze(resources),
    version_id: String(manifest.version_id),
  });
}
