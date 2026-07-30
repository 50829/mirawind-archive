import { SafeApplicationError } from "@/domain/errors";

type SupportedBookSchemaVersion = 3;

export function requireSupportedBookSchemaVersion(
  value: unknown,
): SupportedBookSchemaVersion {
  if (value === 3) return 3;
  if (Number.isSafeInteger(value) && (value as number) > 3) {
    throw new SafeApplicationError(
      "BOOK_SCHEMA_VERSION_UNSUPPORTED",
      "This book configuration uses a newer unsupported schema version.",
      400,
    );
  }
  throw new SafeApplicationError(
    "BOOK_SCHEMA_VERSION_INVALID",
    "The book configuration schema version is invalid.",
    400,
  );
}

function requireVersionTwo(
  value: unknown,
  label: "DOCUMENT_MANIFEST" | "VERSION_MARKER",
): 2 {
  if (value === 2) return 2;
  if (Number.isSafeInteger(value) && (value as number) > 2) {
    throw new SafeApplicationError(
      `${label}_SCHEMA_VERSION_UNSUPPORTED`,
      "This document uses a newer unsupported schema version.",
      400,
    );
  }
  throw new SafeApplicationError(
    `${label}_SCHEMA_VERSION_INVALID`,
    "The document schema version is invalid.",
    400,
  );
}

export function requireSupportedDocumentManifestSchemaVersion(
  value: unknown,
): 2 {
  return requireVersionTwo(value, "DOCUMENT_MANIFEST");
}

export function requireSupportedVersionMarkerSchemaVersion(value: unknown): 2 {
  return requireVersionTwo(value, "VERSION_MARKER");
}
