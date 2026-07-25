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

export interface Utf8ByteRange {
  readonly end_byte: number;
  readonly sha256: string;
  readonly start_byte: number;
}

export interface SourceRegionEntry {
  readonly body_heading_block_id?: string;
  readonly range: Utf8ByteRange;
  readonly reference_level: number;
}

export interface ConfirmedSourceRegion {
  readonly disposition: "reference_only";
  readonly entries: readonly SourceRegionEntry[];
  readonly kind: "printed_toc";
  readonly range: Utf8ByteRange;
  readonly region_id: string;
  readonly source_path: string;
  readonly source_sha256: string;
}

export type TypographyProfile = "preserve-v1" | "zh-smart-v1";

export interface TypographyProvenance {
  readonly input_sha256: string;
  readonly output_sha256: string;
  readonly profile: TypographyProfile;
  readonly protected_nodes: number;
  readonly punctuation_converted: number;
  readonly spaces_normalized: number;
}

export interface SemanticCompilationIdentity {
  readonly compiler_version: string;
  readonly config_sha256: string;
  readonly renderer_version: string;
  readonly semantic_digest: string;
  readonly source_sha256: string;
}
