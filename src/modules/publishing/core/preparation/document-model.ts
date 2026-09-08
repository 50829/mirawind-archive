export type SemanticContainerKind =
  | "definition"
  | "example"
  | "exercise"
  | "note"
  | "proof"
  | "solution"
  | "theorem"
  | "warning"
  | "aside"
  | "algorithm";

export interface TransientDocumentNode {
  readonly data?: {
    readonly hName?: string;
    readonly hProperties?: Readonly<Record<string, unknown>>;
  };
  readonly contentKind?: string;
  readonly alt?: string;
  readonly align?: readonly ("left" | "center" | "right" | null)[];
  readonly blockId?: string;
  readonly checked?: boolean | null;
  readonly children?: readonly TransientDocumentNode[];
  readonly containerKind?: SemanticContainerKind;
  readonly depth?: number;
  readonly identifier?: string;
  readonly lang?: string | null;
  readonly ordered?: boolean | null;
  readonly spread?: boolean;
  readonly start?: number;
  readonly title?: string | null;
  readonly type: string;
  readonly url?: string;
  readonly value?: string;
  readonly visibleText?: string;
}

export interface ParsedDocument {
  readonly root: TransientDocumentNode;
}

export interface NormalizedHeading {
  readonly blockId: string;
  readonly level: number;
  readonly sourceTitle: string;
}

export interface NormalizedDocument {
  readonly root: TransientDocumentNode;
  readonly blocks: readonly TransientDocumentNode[];
  readonly headings: readonly NormalizedHeading[];
}

export type TypographyProfile = "verbatim-v1" | "zh-smart-v2";

export interface SemanticCompilationIdentity {
  readonly compiler_version: string;
  readonly document_sha256: string;
  readonly source_updated_at: number;
  readonly renderer_version: string;
  readonly semantic_digest: string;
}
