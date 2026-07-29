import katex from "katex";

import { createSafeDiagnostic, type SafeDiagnostic } from "@/domain/errors";

export interface MathRenderResult {
  readonly diagnostic?: SafeDiagnostic;
  readonly markup?: string;
  readonly source: string;
}

const MAX_MATH_SOURCE_LENGTH = 100_000;

/**
 * Checks and renders one formula with the same bounded, non-trusting options
 * used by the publication renderer. The returned KaTeX markup is trusted
 * compiler output; source text is returned separately for a safe fallback.
 */
export function renderMath(input: {
  readonly blockId?: string;
  readonly displayMode: boolean;
  readonly source: string;
}): MathRenderResult {
  if (input.source.length > MAX_MATH_SOURCE_LENGTH) {
    return Object.freeze({
      diagnostic: createSafeDiagnostic({
        ...(input.blockId ? { blockId: input.blockId } : {}),
        code: "MATH_RENDER_FAILED",
        message:
          "A formula could not be rendered and remains as source notation.",
      }),
      source: input.source,
    });
  }
  try {
    return Object.freeze({
      markup: katex.renderToString(input.source, {
        displayMode: input.displayMode,
        maxExpand: 1_000,
        maxSize: 50,
        output: "htmlAndMathml",
        strict: "error",
        throwOnError: true,
        trust: false,
      }),
      source: input.source,
    });
  } catch {
    return Object.freeze({
      diagnostic: createSafeDiagnostic({
        ...(input.blockId ? { blockId: input.blockId } : {}),
        code: "MATH_RENDER_FAILED",
        message:
          "A formula could not be rendered and remains as source notation.",
      }),
      source: input.source,
    });
  }
}
