import { SafeApplicationError } from "../domain/errors.js";

export const supportedBookSchemaVersions = Object.freeze([1] as const);
export type SupportedBookSchemaVersion =
  (typeof supportedBookSchemaVersions)[number];

export function requireSupportedBookSchemaVersion(
  value: unknown,
): SupportedBookSchemaVersion {
  if (value === 1) return 1;
  if (Number.isSafeInteger(value) && (value as number) > 1) {
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
