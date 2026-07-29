import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ReaderShell } from "@/components/reader/ReaderShell";

export function renderReaderShell(
  props: Parameters<typeof ReaderShell>[0],
): string {
  return renderToStaticMarkup(createElement(ReaderShell, props));
}
