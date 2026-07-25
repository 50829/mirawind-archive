import { SafeApplicationError } from "../domain/errors.js";

export const supportedBookSchemaVersions = Object.freeze([1, 2] as const);
export const currentBookSchemaVersion = 2 as const;
export const supportedDocumentManifestSchemaVersions = Object.freeze([
  1,
] as const);
export const supportedVersionMarkerSchemaVersions = Object.freeze([1] as const);
export type SupportedBookSchemaVersion =
  (typeof supportedBookSchemaVersions)[number];

export function requireSupportedBookSchemaVersion(
  value: unknown,
): SupportedBookSchemaVersion {
  if (value === 1) return 1;
  if (value === 2) return 2;
  if (Number.isSafeInteger(value) && (value as number) > 2) {
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

function requireVersionOne(
  value: unknown,
  label: "DOCUMENT_MANIFEST" | "VERSION_MARKER",
): 1 {
  if (value === 1) return 1;
  if (Number.isSafeInteger(value) && (value as number) > 1) {
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
): 1 {
  return requireVersionOne(value, "DOCUMENT_MANIFEST");
}

export function requireSupportedVersionMarkerSchemaVersion(value: unknown): 1 {
  return requireVersionOne(value, "VERSION_MARKER");
}
