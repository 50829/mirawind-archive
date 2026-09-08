import type { BookDocument } from "../content/book-document.generated";
import type {
  ContentRole,
  HeadingNumberingMode,
} from "../content/heading-presentation";
import { presentBookHeadings } from "../content/heading-presentation";
import { inlineEditorText } from "../content/editor-text";
import { renderingInline } from "../content/rendering-document";

export type { HeadingNumberingMode };
export interface HeadingPresentation {
  readonly alias?: string;
  readonly block_id: string;
  readonly display_level: number;
  readonly include_in_toc: boolean;
  readonly starts_page: boolean;
  readonly exclude_from_numbering: boolean;
  readonly numbering_excluded: boolean;
  readonly source_number?: string;
  readonly sourceNumber: string | null;
  readonly role: ContentRole;
  readonly title_markdown: string;
  readonly title: string;
  readonly number: string | null;
  readonly label: string;
  readonly titleChildren: Readonly<ReturnType<typeof renderingInline>>;
}

export function presentDocumentHeadings(
  book: BookDocument,
): readonly HeadingPresentation[] {
  return presentBookHeadings(book).map((value) => ({
    ...(value.heading.alias ? { alias: value.heading.alias } : {}),
    block_id: value.heading.id,
    display_level: value.heading.level,
    include_in_toc: value.heading.include_in_toc,
    starts_page: value.heading.starts_page,
    exclude_from_numbering: value.heading.exclude_from_numbering,
    numbering_excluded: value.numberingExcluded,
    ...(value.heading.source_number
      ? { source_number: value.heading.source_number }
      : {}),
    sourceNumber: value.heading.source_number ?? null,
    role: value.role,
    title_markdown: inlineEditorText(value.heading.content, book),
    title: value.title,
    number: value.number,
    label: value.label,
    titleChildren: renderingInline(value.heading.content, book),
  }));
}
