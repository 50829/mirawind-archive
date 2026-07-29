import {
  katexCriticalCss,
  rendererStylesheetUrl,
} from "@/compiler/render/assets";
import { readerStylesheetUrl } from "@/styles/assets";

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderReaderHtmlDocument(input: {
  readonly body: string;
  readonly canonicalPath?: string;
  readonly css: string;
  readonly language: string;
  readonly title: string;
}): string {
  const canonical = input.canonicalPath
    ? `\n<link rel="canonical" href="${htmlEscape(input.canonicalPath)}">`
    : "";
  return `<!doctype html>
<html lang="${htmlEscape(input.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<title>${htmlEscape(input.title)}</title>${canonical}
<link rel="stylesheet" href="${rendererStylesheetUrl}">
<link rel="stylesheet" href="${readerStylesheetUrl}">
<style>${katexCriticalCss}${input.css}</style>
</head>
<body>${input.body}</body>
</html>
`;
}
