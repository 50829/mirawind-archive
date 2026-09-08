/* Generated from docs/schemas/book.schema.json. Run pnpm generate:content-types. */

export type Alias = string;
export type ResourceId = string;
export type Id = string;
export type ContentBlock =
  | HeadingBlock
  | ParagraphBlock
  | CodeBlock
  | MathBlock
  | ImageBlock
  | ListBlock
  | QuoteBlock
  | TableBlock
  | FootnoteBlock
  | ContainerBlock
  | DividerBlock;
export type InlineNode =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "code";
      code: string;
    }
  | {
      type: "math";
      latex: string;
    }
  | {
      type:
        | "emphasis"
        | "strong"
        | "delete"
        | "subscript"
        | "superscript"
        | "underline";
      content: InlineContent;
    }
  | {
      type: "link";
      target: ContentLinkTarget;
      content: InlineContent;
    }
  | {
      type: "image";
      resource_id: ResourceId;
      alt: string;
    }
  | {
      type: "footnote_reference";
      target_id: Id;
    }
  | {
      type: "break";
    };
export type ContentLinkTarget =
  | {
      type: "external";
      url: string;
    }
  | {
      type: "block";
      block_id: Id;
    }
  | {
      type: "resource";
      resource_id: ResourceId;
    };
/**
 * @maxItems 100000
 */
export type InlineContent = InlineNode[];
/**
 * @maxItems 20000
 */
export type BlockContent = ContentBlock[];

/**
 * Editable Mirawind IR; source coordinates and build state are not body fields.
 */
export interface BookDocument {
  schema_version: 1;
  book_id: number;
  updated_at: number;
  alias?: Alias;
  metadata: BookMetadata;
  publishing: BookPublishing;
  /**
   * @minItems 1
   * @maxItems 20000
   */
  blocks: ContentBlock[];
  /**
   * @maxItems 20000
   */
  resources: BookResource[];
}
export interface BookMetadata {
  title: string;
  subtitle?: string;
  /**
   * @maxItems 100
   */
  authors?: string[];
  /**
   * @maxItems 100
   */
  contributors?: string[];
  description?: string;
  language?: string;
  publisher?: string;
  year?: number;
  edition?: string;
  isbn_10?: string;
  isbn_13?: string;
  cover_resource_id?: ResourceId;
}
export interface BookPublishing {
  numbering: "source" | "generated" | "none";
  code: {
    line_numbers: boolean;
  };
  boundaries: BookBoundaries;
}
export interface BookBoundaries {
  body_start_block_id: Id;
  appendix_start_block_id?: Id;
  backmatter_start_block_id?: Id;
}
export interface HeadingBlock {
  id: Id;
  type: "heading";
  level: number;
  content: InlineContent;
  source_number?: string;
  include_in_toc: boolean;
  starts_page: boolean;
  exclude_from_numbering: boolean;
  alias?: Alias;
}
export interface ParagraphBlock {
  id: Id;
  type: "paragraph";
  content: InlineContent;
}
export interface CodeBlock {
  id: Id;
  type: "code";
  code: string;
  language: string;
  caption?: InlineContent;
}
export interface MathBlock {
  id: Id;
  type: "math";
  latex: string;
}
export interface ImageBlock {
  id: Id;
  type: "image";
  resource_id: ResourceId;
  alt: string;
  caption?: InlineContent;
  notes?: BlockContent;
}
export interface ListBlock {
  id: Id;
  type: "list";
  ordered: boolean;
  start?: number;
  /**
   * @minItems 1
   * @maxItems 20000
   */
  items: ListItem[];
}
export interface ListItem {
  id: Id;
  content: BlockContent;
  checked?: boolean;
}
export interface QuoteBlock {
  id: Id;
  type: "quote";
  content: BlockContent;
}
export interface TableBlock {
  id: Id;
  type: "table";
  /**
   * @minItems 1
   * @maxItems 20000
   */
  rows: TableCell[][];
  caption?: InlineContent;
  notes?: BlockContent;
}
export interface TableCell {
  content: BlockContent;
  header: boolean;
  row_span: number;
  col_span: number;
  align?: "left" | "center" | "right";
}
export interface FootnoteBlock {
  id: Id;
  type: "footnote";
  content: BlockContent;
  label?: string;
}
export interface ContainerBlock {
  id: Id;
  type: "container";
  kind:
    | "definition"
    | "theorem"
    | "proof"
    | "example"
    | "exercise"
    | "solution"
    | "note"
    | "warning"
    | "aside"
    | "algorithm";
  content: BlockContent;
}
export interface DividerBlock {
  id: Id;
  type: "divider";
}
export interface BookResource {
  id: ResourceId;
  path: string;
  media_type: string;
}
