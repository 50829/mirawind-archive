import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import { isAlias, isMap, isPair, isSeq, parseDocument } from "yaml";

import bookSchema from "../../docs/schemas/book.schema.json" with { type: "json" };
import { SafeApplicationError } from "@/domain/errors";
import { requireSupportedBookSchemaVersion } from "@/schemas/versioning";

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
const validateVersionThree = ajv.compile(bookSchema);

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
  if (!validateVersionThree(config)) {
    throw new BookConfigValidationError(
      "BOOK_CONFIG_INVALID",
      "The book configuration does not match its schema.",
      diagnostics(validateVersionThree.errors),
    );
  }
  validateVersionThreeSemantics(config);
  return freezeDeep(config);
}

interface ByteRangeRecord {
  readonly end_byte: number;
  readonly sha256: string;
  readonly start_byte: number;
}

function semanticFailure(instancePath: string): never {
  throw new BookConfigValidationError(
    "BOOK_CONFIG_INVALID",
    "The book configuration violates a semantic constraint.",
    [Object.freeze({ instancePath, keyword: "x-semantic-validations" })],
  );
}

function requireIncreasingRange(
  range: ByteRangeRecord,
  instancePath: string,
): void {
  if (range.start_byte >= range.end_byte) semanticFailure(instancePath);
}

function validateVersionThreeSemantics(config: Record<string, unknown>): void {
  const source = config.source as {
    readonly main_markdown: string;
    readonly main_markdown_sha256: string;
    readonly preprocessing: {
      readonly typography: {
        readonly output_sha256: string;
      };
    };
  };
  if (
    source.preprocessing.typography.output_sha256 !==
    source.main_markdown_sha256
  ) {
    semanticFailure("/source/preprocessing/typography/output_sha256");
  }

  const structure = config.structure as readonly {
    readonly block_id: string;
  }[];
  const structureIndexes = new Map(
    structure.map((node, index) => [node.block_id, index]),
  );
  const seenTargets = new Set<string>();
  const regions = config.source_regions as readonly {
    readonly entries: readonly {
      readonly body_heading_block_id?: string;
      readonly range: ByteRangeRecord;
    }[];
    readonly range: ByteRangeRecord;
    readonly source_path: string;
    readonly source_sha256: string;
  }[];
  let previousRegionEnd = -1;
  let totalEntries = 0;
  for (const [regionIndex, region] of regions.entries()) {
    const regionPath = `/source_regions/${regionIndex}`;
    requireIncreasingRange(region.range, `${regionPath}/range`);
    if (
      region.range.start_byte < previousRegionEnd ||
      region.source_path !== source.main_markdown ||
      region.source_sha256 !== source.main_markdown_sha256
    ) {
      semanticFailure(regionPath);
    }
    previousRegionEnd = region.range.end_byte;
    let previousEntryEnd = region.range.start_byte;
    let previousTargetIndex = -1;
    totalEntries += region.entries.length;
    if (totalEntries > 20_000) semanticFailure("/source_regions");
    for (const [entryIndex, entry] of region.entries.entries()) {
      const entryPath = `${regionPath}/entries/${entryIndex}`;
      requireIncreasingRange(entry.range, `${entryPath}/range`);
      if (
        entry.range.start_byte < previousEntryEnd ||
        entry.range.start_byte < region.range.start_byte ||
        entry.range.end_byte > region.range.end_byte
      ) {
        semanticFailure(`${entryPath}/range`);
      }
      previousEntryEnd = entry.range.end_byte;
      if (entry.body_heading_block_id) {
        const targetIndex = structureIndexes.get(entry.body_heading_block_id);
        if (
          targetIndex === undefined ||
          targetIndex <= previousTargetIndex ||
          seenTargets.has(entry.body_heading_block_id)
        ) {
          semanticFailure(`${entryPath}/body_heading_block_id`);
        }
        previousTargetIndex = targetIndex;
        seenTargets.add(entry.body_heading_block_id);
      }
    }
  }
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
