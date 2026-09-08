import {
  buildZip,
  type ZipEntryInput,
} from "../../scripts/fixtures/zip-builder";

export const mineruText = (content: string) => ({ type: "text", content });
export const mineruTitle = (title: string, level = 1) => ({
  type: "title",
  content: { level, title_content: [mineruText(title)] },
});
export const mineruParagraph = (text: string) => ({
  type: "paragraph",
  content: { paragraph_content: [mineruText(text)] },
});

export function mineruZip(
  pages: readonly (readonly unknown[])[],
  resources: readonly ZipEntryInput[] = [],
) {
  return buildZip({
    entries: [
      { name: "result/content_list_v2.json", data: JSON.stringify(pages) },
      ...resources,
    ],
  });
}
