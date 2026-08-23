import { compilerIdentity } from "./manifest";

export const rendererAssetBaseUrl =
  `/reader-assets/renderers/${compilerIdentity.renderer_version}` as const;
export const rendererStylesheetUrl =
  `${rendererAssetBaseUrl}/katex.css` as const;

export const katexCriticalCss =
  ".katex .katex-mathml{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);clip-path:inset(50%);white-space:nowrap;border:0}" as const;
