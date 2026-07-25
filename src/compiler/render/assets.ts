import { compilerIdentity } from "../document/manifest.js";

export const rendererAssetBaseUrl =
  `/_astro/renderers/${compilerIdentity.renderer_version}` as const;
export const rendererStylesheetUrl =
  `${rendererAssetBaseUrl}/katex.css` as const;
