import { publishingReaderRendererAssets } from "@/modules/publishing/application/public";
import {
  acceptedReaderAssetPath as acceptAssetPath,
  readerAssetIdentity,
  readerMermaidScriptUrl,
  readerScriptUrl,
  readerStylesheetUrl,
} from "@/modules/reader/core/asset-policy";
import { normalizeSearchQuery } from "@/modules/reader/core/search-query";
import {
  buildReaderNavigationTree,
  readerBreadcrumbs,
} from "@/modules/reader/core/navigation";

export type { NormalizedSearchQuery } from "@/modules/reader/core/search-query";
export type {
  ReaderTocLink,
  ReaderTocNode,
} from "@/modules/reader/core/navigation";
export type {
  ReaderOutlineLink,
  ReaderPageModel,
} from "@/modules/reader/core/page-model";

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
