# Locatable Diagnostic Contract

```ts
interface SafeDiagnostic {
  readonly code: string;
  readonly severity: "error" | "warning" | "info";
  readonly phase:
    | "selection"
    | "contents"
    | "matching"
    | "structure"
    | "splitting"
    | "typography"
    | "ocr";
  readonly confidence?: "high" | "medium" | "low";
  readonly message: string;
  readonly evidence?: readonly string[];
  readonly proposal?: string;
  readonly location:
    | { readonly kind: "block"; readonly blockId: string }
    | { readonly kind: "region"; readonly regionId: string }
    | { readonly kind: "page"; readonly pageIndex: number }
    | {
        readonly kind: "range";
        readonly startByte: number;
        readonly endByte: number;
      };
  readonly recovery: readonly (
    "select_structure" | "enable_region" | "reload" | "reprocess_verbatim"
  )[];
}
```

All strings, arrays and integers are bounded and unknown enum values are rejected when reading
generated artifacts. A diagnostic never includes full source text, OCR output or raw archive
paths. Every warning/error has one valid location and at least one action valid for its phase.

Activation selects the block/nearest related block, pins the iframe to the correct revision,
navigates to the page/fragment and returns focus to the invoking control when a dialog closes.
Recovery calls use existing authenticated draft APIs and preserve dirty/conflict safeguards.
