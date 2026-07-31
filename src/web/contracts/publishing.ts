import type { SafeDiagnostic } from "@/domain/errors";
import type { CurrentDraftCandidateProjection } from "@/modules/publishing/application/public";

export type PreviewDiagnostic = SafeDiagnostic;

export interface PreviewHeading {
  readonly block_id: string;
  readonly display_level: number;
  readonly include_in_toc: boolean;
  readonly page_id: number | null;
  readonly source_number: string | null;
  readonly source_level: number;
  readonly starts_page: boolean;
  readonly source_title?: string;
  readonly title: string;
  readonly title_markdown: string;
}

export interface PreviewPage {
  readonly page_id: number;
  readonly title: string;
}

export interface TypographySummary {
  readonly profile: "verbatim-v1" | "zh-smart-v2";
  readonly protected_nodes: number;
  readonly punctuation_converted: number;
  readonly spaces_normalized: number;
}

export interface DraftView {
  readonly access: "private" | "public";
  readonly alias: string | null;
  readonly boundaries: {
    readonly appendix_start_block_id?: string;
    readonly backmatter_start_block_id?: string;
    readonly body_start_block_id: string;
  };
  readonly book_id: number;
  readonly candidate: CurrentDraftCandidateProjection | null;
  readonly candidate_published: boolean;
  readonly config_revision: number;
  readonly diagnostics: readonly PreviewDiagnostic[];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly published: boolean;
  readonly preview: {
    readonly boundaries: DraftView["boundaries"];
    readonly compiler_version: string;
    readonly config_sha256: string;
    readonly config_revision: number;
    readonly content_cleanup?: {
      readonly helper_blocks_removed: number;
      readonly printed_toc_regions_removed: number;
    };
    readonly headings: readonly PreviewHeading[];
    readonly is_stale: boolean;
    readonly pages: readonly PreviewPage[];
    readonly renderer_version: string;
    readonly semantic_digest: string;
    readonly source_sha256: string;
    readonly typography?: TypographySummary;
  } | null;
  readonly structure: readonly {
    readonly block_id: string;
    readonly display_level: number;
    readonly include_in_toc: boolean;
    readonly source_number?: string;
    readonly starts_page: boolean;
    readonly title_markdown: string;
  }[];
  readonly title: string;
}

export interface RecoveryJob {
  readonly error_code: string | null;
  readonly job_id: string;
  readonly state:
    "canceled" | "failed" | "interrupted" | "queued" | "running" | "succeeded";
}
