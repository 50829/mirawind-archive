import { SafeApplicationError } from "@/domain/errors";

type SupportedBookSchemaVersion = 4;

export function requireSupportedBookSchemaVersion(
  value: unknown,
): SupportedBookSchemaVersion {
  if (value === 4) return 4;
  if (Number.isSafeInteger(value) && (value as number) > 4) {
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

function requireVersionThree(
  value: unknown,
  label: "DOCUMENT_MANIFEST" | "VERSION_MARKER",
): 3 {
  if (value === 3) return 3;
  if (Number.isSafeInteger(value) && (value as number) > 3) {
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
): 3 {
  return requireVersionThree(value, "DOCUMENT_MANIFEST");
}

export function requireSupportedVersionMarkerSchemaVersion(value: unknown): 3 {
  return requireVersionThree(value, "VERSION_MARKER");
}
