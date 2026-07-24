export interface SourcePoint {
  readonly column: number;
  readonly line: number;
  readonly offset: number;
}

export interface SourcePosition {
  readonly end: SourcePoint;
  readonly start: SourcePoint;
}

export type SemanticContainerKind =
  | "definition"
  | "example"
  | "exercise"
  | "note"
  | "proof"
  | "solution"
  | "theorem"
  | "warning";

export interface TransientDocumentNode {
  readonly alt?: string;
  readonly blockId?: string;
  readonly checked?: boolean | null;
  readonly children?: readonly TransientDocumentNode[];
  readonly containerKind?: SemanticContainerKind;
  readonly depth?: number;
  readonly identifier?: string;
  readonly lang?: string | null;
  readonly ordered?: boolean | null;
  readonly position?: SourcePosition;
  readonly spread?: boolean;
  readonly textFingerprint?: string;
  readonly title?: string | null;
  readonly type: string;
  readonly url?: string;
  readonly value?: string;
  readonly visibleText?: string;
}

export interface ParsedDocument {
  readonly root: TransientDocumentNode;
  readonly source: string;
}

export interface NormalizedHeading {
  readonly blockId: string;
  readonly level: number;
  readonly position?: SourcePosition;
  readonly sourceTitle: string;
  readonly textFingerprint: string;
}

export interface NormalizedDocument extends ParsedDocument {
  readonly blocks: readonly TransientDocumentNode[];
  readonly headings: readonly NormalizedHeading[];
}
