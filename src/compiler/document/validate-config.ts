import { SafeApplicationError } from "../../domain/errors.js";
import { validateBookConfig } from "../../schemas/book-config.js";
import type { ContentRole } from "./structure-proposal.js";
import type { NormalizedDocument } from "./types.js";

export interface ConfigSemanticDiagnostic {
  readonly block_id?: string;
  readonly code:
    | "DISPLAY_LEVEL_SKIPPED"
    | "HEADING_ORDER_CHANGED"
    | "HEADING_REQUIRED"
    | "HEADING_SET_MISMATCH"
    | "HEADING_UNKNOWN"
    | "PAGE_ALIAS_DUPLICATE"
    | "PAGE_ALIAS_REQUIRES_START"
    | "ROLE_REQUIRES_TOP_LEVEL";
  readonly field?: string;
}

export class ConfigSemanticValidationError extends SafeApplicationError {
  readonly diagnostics: readonly ConfigSemanticDiagnostic[];

  constructor(diagnostics: readonly ConfigSemanticDiagnostic[]) {
    super(
      "BOOK_CONFIG_SEMANTIC_INVALID",
      "The book configuration does not match the source document.",
      400,
    );
    this.name = "ConfigSemanticValidationError";
    this.diagnostics = Object.freeze(diagnostics.slice(0, 100));
  }
}

interface StructureNode {
  readonly alias?: string;
  readonly block_id: string;
  readonly display_level: number;
  readonly display_title?: string;
  readonly include_in_toc: boolean;
  readonly role?: ContentRole;
  readonly starts_page: boolean;
}

export interface ValidatedConfiguredHeading {
  readonly alias?: string;
  readonly block_id: string;
  readonly display_level: number;
  readonly display_title: string;
  readonly include_in_toc: boolean;
  readonly role: ContentRole;
  readonly source_level: number;
  readonly source_title: string;
  readonly starts_page: boolean;
}

export interface ValidatedDocumentConfig {
  readonly config: Readonly<Record<string, unknown>>;
  readonly headings: readonly ValidatedConfiguredHeading[];
}

function structureOf(
  config: Readonly<Record<string, unknown>>,
): readonly StructureNode[] {
  return config.structure as readonly StructureNode[];
}

function diagnostic(
  code: ConfigSemanticDiagnostic["code"],
  blockId?: string,
  field?: string,
): ConfigSemanticDiagnostic {
  return Object.freeze({
    ...(blockId ? { block_id: blockId } : {}),
    code,
    ...(field ? { field } : {}),
  });
}

export function validateDocumentConfig(input: {
  readonly config: unknown;
  readonly document: NormalizedDocument;
}): ValidatedDocumentConfig {
  const config = validateBookConfig(input.config);
  const structure = structureOf(config);
  const diagnostics: ConfigSemanticDiagnostic[] = [];
  if (structure.length !== input.document.headings.length) {
    diagnostics.push(
      diagnostic("HEADING_SET_MISMATCH", undefined, "structure"),
    );
  }
  const headingIds = new Set(
    input.document.headings.map((heading) => heading.blockId),
  );
  const blockIds = new Set(
    input.document.blocks.flatMap((block) =>
      block.blockId ? [block.blockId] : [],
    ),
  );
  const aliases = new Set<string>();
  const headings: ValidatedConfiguredHeading[] = [];
  let previousLevel = 0;
  let inheritedRole: ContentRole = "body";

  for (let index = 0; index < structure.length; index += 1) {
    const configured = structure[index];
    const source = input.document.headings[index];
    if (!configured) continue;
    if (!source || configured.block_id !== source.blockId) {
      const code = headingIds.has(configured.block_id)
        ? "HEADING_ORDER_CHANGED"
        : blockIds.has(configured.block_id)
          ? "HEADING_REQUIRED"
          : "HEADING_UNKNOWN";
      diagnostics.push(
        diagnostic(code, configured.block_id, `structure/${index}/block_id`),
      );
    }
    if (
      (index === 0 && configured.display_level !== 1) ||
      (index > 0 && configured.display_level > previousLevel + 1)
    ) {
      diagnostics.push(
        diagnostic(
          "DISPLAY_LEVEL_SKIPPED",
          configured.block_id,
          `structure/${index}/display_level`,
        ),
      );
    }
    previousLevel = configured.display_level;

    if (configured.display_level === 1) {
      inheritedRole = configured.role ?? "body";
    } else if (configured.role !== undefined) {
      diagnostics.push(
        diagnostic(
          "ROLE_REQUIRES_TOP_LEVEL",
          configured.block_id,
          `structure/${index}/role`,
        ),
      );
    }
    if (configured.alias) {
      if (!configured.starts_page) {
        diagnostics.push(
          diagnostic(
            "PAGE_ALIAS_REQUIRES_START",
            configured.block_id,
            `structure/${index}/alias`,
          ),
        );
      }
      if (aliases.has(configured.alias)) {
        diagnostics.push(
          diagnostic(
            "PAGE_ALIAS_DUPLICATE",
            configured.block_id,
            `structure/${index}/alias`,
          ),
        );
      }
      aliases.add(configured.alias);
    }
    if (source) {
      headings.push(
        Object.freeze({
          ...(configured.alias ? { alias: configured.alias } : {}),
          block_id: configured.block_id,
          display_level: configured.display_level,
          display_title: configured.display_title ?? source.sourceTitle,
          include_in_toc: configured.include_in_toc,
          role: inheritedRole,
          source_level: source.level,
          source_title: source.sourceTitle,
          starts_page: configured.starts_page,
        }),
      );
    }
  }
  if (diagnostics.length > 0) {
    throw new ConfigSemanticValidationError(diagnostics);
  }
  return Object.freeze({
    config,
    headings: Object.freeze(headings),
  });
}
