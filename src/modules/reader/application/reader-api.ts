import { publishingReaderRendererAssets } from "@/modules/publishing/application/publishing-api";
import {
  acceptedReaderAssetPath as acceptAssetPath,
  readerAssetIdentity,
  readerMermaidScriptUrl,
  readerScriptUrl,
  readerStylesheetUrl,
} from "../core/asset-policy";
import { normalizeSearchQuery } from "../core/search-query";
import {
  buildReaderNavigationTree,
  readerBreadcrumbs,
} from "../core/navigation";

export type { NormalizedSearchQuery } from "../core/search-query";
export type { ReaderTocLink, ReaderTocNode } from "../core/navigation";
export type { ReaderOutlineLink, ReaderPageModel } from "../core/page-model";

export {
  normalizeSearchQuery,
  buildReaderNavigationTree,
  readerBreadcrumbs,
  readerAssetIdentity,
  readerMermaidScriptUrl,
  readerScriptUrl,
  readerStylesheetUrl,
};

export const readerRendererAssets = Object.freeze({
  criticalCss: publishingReaderRendererAssets.criticalCss,
  stylesheetUrl: publishingReaderRendererAssets.stylesheetUrl,
});

export function acceptedReaderAssetPath(
  assetPath: string | undefined,
): string | null {
  return acceptAssetPath(assetPath, publishingReaderRendererAssets.identity);
}
