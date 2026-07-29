import { isOpaqueId } from "@/domain/ids";

export class SafeApplicationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SafeApplicationError";
  }
}

export function safeErrorCode(error: unknown): string {
  return error instanceof SafeApplicationError
    ? error.code
    : "INTERNAL_SERVER_ERROR";
}

export interface SafeDiagnostic {
  readonly blockId?: string;
  readonly code: string;
  readonly confidence?: "high" | "low" | "medium";
  readonly evidence?: readonly string[];
  readonly location?: {
    readonly blockId?: string;
    readonly endByte?: number;
    readonly pageIndex?: number;
    readonly regionId?: string;
    readonly startByte?: number;
  };
  readonly message: string;
  readonly path?: string;
  readonly phase?:
    | "contents"
    | "matching"
    | "ocr"
    | "selection"
    | "splitting"
    | "structure"
    | "typography";
  readonly recovery?: readonly (
    "reload" | "reprocess_verbatim" | "select_structure"
  )[];
  readonly severity?: "error" | "info" | "warning";
}

export function createSafeDiagnostic(input: SafeDiagnostic): SafeDiagnostic {
  if (!/^[A-Z][A-Z0-9_]{2,79}$/.test(input.code)) {
    throw new TypeError("Diagnostic code is invalid");
  }
  const confidence = ["high", "low", "medium"].includes(
    String(input.confidence),
  )
    ? input.confidence
    : undefined;
  const phase = [
    "contents",
    "matching",
    "ocr",
    "selection",
    "splitting",
    "structure",
    "typography",
  ].includes(String(input.phase))
    ? input.phase
    : undefined;
  const recovery = (input.recovery ?? [])
    .filter((value) =>
      ["reload", "reprocess_verbatim", "select_structure"].includes(value),
    )
    .slice(0, 4);
  const location = input.location;
  const validRange =
    location?.startByte !== undefined &&
    location.endByte !== undefined &&
    Number.isSafeInteger(location.startByte) &&
    Number.isSafeInteger(location.endByte) &&
    location.startByte >= 0 &&
    location.endByte > location.startByte;
  const safeLocation = location
    ? Object.freeze({
        ...(location.blockId && isOpaqueId("block", location.blockId)
          ? { blockId: location.blockId }
          : {}),
        ...(validRange
          ? { endByte: location.endByte, startByte: location.startByte }
          : {}),
        ...(Number.isSafeInteger(location.pageIndex) &&
        Number(location.pageIndex) >= 0
          ? { pageIndex: Number(location.pageIndex) }
          : {}),
        ...(location.regionId && isOpaqueId("region", location.regionId)
          ? { regionId: location.regionId }
          : {}),
      })
    : undefined;
  return Object.freeze({
    ...(input.blockId && isOpaqueId("block", input.blockId)
      ? { blockId: input.blockId }
      : {}),
    code: input.code,
    ...(confidence ? { confidence } : {}),
    ...(input.evidence
      ? {
          evidence: Object.freeze(
            input.evidence
              .filter((value) => typeof value === "string")
              .slice(0, 10)
              .map((value) => value.slice(0, 200)),
          ),
        }
      : {}),
    ...(safeLocation && Object.keys(safeLocation).length > 0
      ? { location: safeLocation }
      : {}),
    message: input.message.slice(0, 500),
    ...(input.path ? { path: input.path.slice(0, 500) } : {}),
    ...(phase ? { phase } : {}),
    ...(recovery.length > 0 ? { recovery: Object.freeze(recovery) } : {}),
    ...(input.severity ? { severity: input.severity } : {}),
  });
}
