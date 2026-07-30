import type { SafeDiagnostic } from "@/domain/errors";
import type { CurrentDraftCandidateProjection } from "@/modules/publishing/application/public";

export type PreviewDiagnostic = SafeDiagnostic;

export interface PreviewHeading {
  readonly block_id: string;
  readonly display_level: number;
  readonly include_in_toc: boolean;
  readonly page_id: number | null;
  readonly role: "frontmatter" | "body" | "appendix" | "backmatter";
  readonly source_level: number;
  readonly starts_page: boolean;
  readonly source_title?: string;
  readonly title: string;
}

export interface PreviewPage {
  readonly page_id: number;
  readonly title: string;
}

export interface PreviewRegion {
  readonly applied: boolean;
  readonly block_id?: string;
  readonly end_byte: number;
  readonly entry_count: number;
  readonly matched_heading_count: number;
  readonly region_id: string;
  readonly start_byte: number;
}

export interface TypographySummary {
  readonly profile: "verbatim-v1" | "zh-smart-v1";
  readonly protected_nodes: number;
  readonly punctuation_converted: number;
  readonly spaces_normalized: number;
}

export interface DraftView {
  readonly book_id: number;
  readonly candidate: CurrentDraftCandidateProjection | null;
  readonly config_revision: number;
  readonly diagnostics: readonly PreviewDiagnostic[];
  readonly regions: readonly {
    readonly applied: boolean;
    readonly entry_count: number;
    readonly region_id: string;
  }[];
  readonly preview: {
    readonly compiler_version: string;
    readonly config_sha256: string;
    readonly config_revision: number;
    readonly headings: readonly PreviewHeading[];
    readonly is_stale: boolean;
    readonly pages: readonly PreviewPage[];
    readonly renderer_version: string;
    readonly semantic_digest: string;
    readonly source_regions: readonly PreviewRegion[];
    readonly source_sha256: string;
    readonly typography?: TypographySummary;
  } | null;
  readonly structure: readonly {
    readonly block_id: string;
    readonly display_level: number;
    readonly display_title?: string;
    readonly include_in_toc: boolean;
    readonly role?: "frontmatter" | "body" | "appendix" | "backmatter";
    readonly starts_page: boolean;
  }[];
  readonly title: string;
}

export interface RecoveryJob {
  readonly error_code: string | null;
  readonly job_id: string;
  readonly state:
    "canceled" | "failed" | "interrupted" | "queued" | "running" | "succeeded";
}
