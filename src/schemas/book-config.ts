import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";
import { isAlias, isMap, isPair, isSeq, parseDocument } from "yaml";

import bookSchema from "../../docs/schemas/book.schema.json" with { type: "json" };
import { SafeApplicationError } from "../domain/errors.js";
import { requireSupportedBookSchemaVersion } from "./versioning.js";

export interface BookConfigDiagnostic {
  readonly instancePath: string;
  readonly keyword: string;
}

export class BookConfigValidationError extends SafeApplicationError {
  readonly diagnostics: readonly BookConfigDiagnostic[];

  constructor(
    code:
      | "BOOK_CONFIG_INVALID"
      | "BOOK_CONFIG_YAML_FORBIDDEN"
      | "BOOK_CONFIG_YAML_INVALID",
    message: string,
    diagnostics: readonly BookConfigDiagnostic[] = [],
    cause?: unknown,
  ) {
    super(code, message, 400, { cause });
    this.name = "BookConfigValidationError";
    this.diagnostics = Object.freeze(diagnostics);
  }
}

const ajv = new Ajv2020({
  allErrors: true,
  coerceTypes: false,
  removeAdditional: false,
  strict: true,
  useDefaults: false,
});
ajv.addKeyword({
  keyword: "x-semantic-validations",
  schemaType: "array",
  valid: true,
});
const validateSchema = ajv.compile(bookSchema);

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
}

function inspectYamlNode(node: unknown): void {
  if (!node || typeof node !== "object") return;
  if (isAlias(node)) {
    throw new BookConfigValidationError(
      "BOOK_CONFIG_YAML_FORBIDDEN",
      "YAML aliases are not allowed in book configuration.",
    );
  }
  if (isPair(node)) {
    if (
      node.key &&
      typeof node.key === "object" &&
      "value" in node.key &&
      node.key.value === "<<"
    ) {
      throw new BookConfigValidationError(
        "BOOK_CONFIG_YAML_FORBIDDEN",
        "YAML merge keys are not allowed in book configuration.",
      );
    }
    inspectYamlNode(node.key);
    inspectYamlNode(node.value);
    return;
  }
  if (isMap(node) || isSeq(node)) {
    for (const item of node.items) inspectYamlNode(item);
  }
}

function diagnostics(
  errors: readonly ErrorObject[] | null | undefined,
): readonly BookConfigDiagnostic[] {
  return Object.freeze(
    (errors ?? []).slice(0, 100).map((error) =>
      Object.freeze({
        instancePath: error.instancePath.slice(0, 2_048),
        keyword: error.keyword.slice(0, 80),
      }),
    ),
  );
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BookConfigValidationError(
      "BOOK_CONFIG_INVALID",
      "The book configuration must be an object.",
    );
  }
  return value as Record<string, unknown>;
}

function requireJsonData(value: unknown): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw new BookConfigValidationError(
      "BOOK_CONFIG_YAML_FORBIDDEN",
      "Non-finite YAML numbers are not allowed.",
    );
  }
  if (Array.isArray(value)) {
    for (const item of value) requireJsonData(item);
    return;
  }
  if (value && typeof value === "object") {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new BookConfigValidationError(
        "BOOK_CONFIG_YAML_FORBIDDEN",
        "Book configuration must contain only JSON-compatible data.",
      );
    }
    for (const item of Object.values(value)) requireJsonData(item);
    return;
  }
  throw new BookConfigValidationError(
    "BOOK_CONFIG_YAML_FORBIDDEN",
    "Book configuration must contain only JSON-compatible data.",
  );
}

export function validateBookConfig(
  input: unknown,
): Readonly<Record<string, unknown>> {
  const config = objectRecord(input);
  requireSupportedBookSchemaVersion(config.schema_version);
  if (!validateSchema(config)) {
    throw new BookConfigValidationError(
      "BOOK_CONFIG_INVALID",
      "The book configuration does not match its schema.",
      diagnostics(validateSchema.errors),
    );
  }
  return freezeDeep(config);
}

export function parseBookConfigYaml(
  yaml: string,
): Readonly<Record<string, unknown>> {
  const document = parseDocument(yaml, {
    customTags: [],
    merge: false,
    prettyErrors: false,
    schema: "core",
    uniqueKeys: true,
    version: "1.2",
  });
  if (document.errors.length > 0) {
    throw new BookConfigValidationError(
      "BOOK_CONFIG_YAML_INVALID",
      "The book configuration is not strict YAML 1.2 JSON data.",
      [],
      document.errors[0],
    );
  }
  inspectYamlNode(document.contents);
  let value: unknown;
  try {
    value = document.toJS({ mapAsMap: false, maxAliasCount: 0 });
  } catch (cause) {
    throw new BookConfigValidationError(
      "BOOK_CONFIG_YAML_INVALID",
      "The book configuration could not be decoded.",
      [],
      cause,
    );
  }
  requireJsonData(value);
  return validateBookConfig(value);
}
