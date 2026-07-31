import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import { isAlias, isMap, isPair, isSeq, parseDocument } from "yaml";

import bookSchema from "@/schemas/book.schema.json" with { type: "json" };
import { SafeApplicationError } from "@/domain/errors";
import { requireSupportedBookSchemaVersion } from "@/modules/publishing/core/publication/versioning-schema";
import { parseHeadingMarkdown } from "@/modules/publishing/core/publication/heading-markdown";

export interface BookConfigDiagnostic {
  readonly instancePath: string;
  readonly keyword: string;
}

class BookConfigValidationError extends SafeApplicationError {
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
const validateVersionFour = ajv.compile(bookSchema);

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
  if (!validateVersionFour(config)) {
    throw new BookConfigValidationError(
      "BOOK_CONFIG_INVALID",
      "The book configuration does not match its schema.",
      diagnostics(validateVersionFour.errors),
    );
  }
  validateVersionFourSemantics(config);
  return freezeDeep(config);
}

interface SourceBlockRecord {
  readonly block_id: string;
  readonly end_offset: number;
  readonly kind: string;
  readonly start_offset: number;
  readonly text_fingerprint: string;
}

interface StructureRecord {
  readonly alias?: string;
  readonly block_id: string;
  readonly display_level: number;
  readonly starts_page: boolean;
  readonly title_markdown: string;
}

function semanticFailure(instancePath: string): never {
  throw new BookConfigValidationError(
    "BOOK_CONFIG_INVALID",
    "The book configuration violates a semantic constraint.",
    [Object.freeze({ instancePath, keyword: "x-semantic-validations" })],
  );
}

function validateVersionFourSemantics(config: Record<string, unknown>): void {
  const source = config.source as {
    readonly blocks: readonly SourceBlockRecord[];
    readonly main_markdown_sha256: string;
    readonly preprocessing: {
      readonly content_cleanup: {
        readonly input_sha256: string;
        readonly output_sha256: string;
      };
      readonly typography: {
        readonly output_sha256: string;
      };
    };
  };
  if (
    source.preprocessing.typography.output_sha256 !==
      source.preprocessing.content_cleanup.input_sha256 ||
    source.preprocessing.content_cleanup.output_sha256 !==
      source.main_markdown_sha256
  ) {
    semanticFailure("/source/preprocessing");
  }
  const blockIndexById = new Map<string, number>();
  let previousStart = -1;
  let previousEnd = Number.POSITIVE_INFINITY;
  for (const [index, block] of source.blocks.entries()) {
    if (
      blockIndexById.has(block.block_id) ||
      block.start_offset >= block.end_offset ||
      block.start_offset < previousStart ||
      (block.start_offset === previousStart && block.end_offset > previousEnd)
    ) {
      semanticFailure(`/source/blocks/${index}`);
    }
    blockIndexById.set(block.block_id, index);
    previousStart = block.start_offset;
    previousEnd = block.end_offset;
  }

  const structure = config.structure as readonly StructureRecord[];
  if (
    source.blocks.filter((block) => block.kind === "heading").length !==
    structure.length
  ) {
    semanticFailure("/structure");
  }
  const structureIds = new Set<string>();
  const aliases = new Set<string>();
  let previousStructureIndex = -1;
  for (const [index, node] of structure.entries()) {
    const blockIndex = blockIndexById.get(node.block_id);
    const block =
      blockIndex === undefined ? undefined : source.blocks[blockIndex];
    if (
      blockIndex === undefined ||
      block?.kind !== "heading" ||
      blockIndex <= previousStructureIndex ||
      structureIds.has(node.block_id) ||
      (node.alias !== undefined &&
        (!node.starts_page || aliases.has(node.alias)))
    ) {
      semanticFailure(`/structure/${index}`);
    }
    try {
      parseHeadingMarkdown(node.title_markdown);
    } catch {
      semanticFailure(`/structure/${index}/title_markdown`);
    }
    structureIds.add(node.block_id);
    if (node.alias) aliases.add(node.alias);
    previousStructureIndex = blockIndex;
  }

  const boundaries = config.boundaries as {
    readonly appendix_start_block_id?: string;
    readonly backmatter_start_block_id?: string;
    readonly body_start_block_id: string;
  };
  const boundaryIds = [
    boundaries.body_start_block_id,
    boundaries.appendix_start_block_id,
    boundaries.backmatter_start_block_id,
  ].filter((value): value is string => value !== undefined);
  const structureIndexById = new Map(
    structure.map((node, index) => [node.block_id, index] as const),
  );
  const boundaryIndexes = boundaryIds.map((blockId) =>
    structureIndexById.get(blockId),
  );
  if (
    boundaryIndexes.some((index) => index === undefined) ||
    boundaryIndexes.some(
      (index, position) =>
        position > 0 && Number(index) <= Number(boundaryIndexes[position - 1]),
    )
  ) {
    semanticFailure("/boundaries");
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
