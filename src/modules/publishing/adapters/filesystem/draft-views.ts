import { mkdir, open, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { contentEntries } from "../../core/content/content-tree";
import { inlineEditorText } from "../../core/content/editor-text";
import type { BookDocument } from "../../core/content/book-document.generated";
import { atomicWriteFile } from "@/platform/filesystem/atomic-file";

export async function writeDraftViews(
  book: BookDocument,
  draftRoot: string,
): Promise<void> {
  const root = resolve(draftRoot, "views", String(book.updated_at));
  await mkdir(root, { recursive: true, mode: 0o700 });
  const handle = await open(resolve(root, "blocks.ndjson"), "w", 0o600);
  const index: Record<
    string,
    { offset: number; length: number; kind: string }
  > = {};
  let offset = 0;
  try {
    let buffer: string[] = [];
    let buffered = 0;
    for (const entry of contentEntries(book.blocks)) {
      const line = JSON.stringify(entry.node) + "\n";
      const length = Buffer.byteLength(line);
      index[entry.node.id] = { offset, length, kind: entry.kind };
      if (length > 8 * 1024 * 1024) {
        index[entry.node.id] = { offset: 0, length: 0, kind: entry.kind };
        continue;
      }
      buffer.push(line);
      buffered += length;
      offset += length;
      if (offset > 1024 * 1024 * 1024)
        throw new Error("DRAFT_VIEW_LIMIT_EXCEEDED");
      if (buffered >= 256 * 1024) {
        await handle.writeFile(buffer.join(""));
        buffer = [];
        buffered = 0;
      }
    }
    if (buffer.length) await handle.writeFile(buffer.join(""));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await atomicWriteFile(
    resolve(root, "index.json"),
    JSON.stringify({
      book_id: book.book_id,
      updated_at: book.updated_at,
      index,
    }) + "\n",
    { mode: 0o600 },
  );
  await atomicWriteFile(
    resolve(root, "view.json"),
    JSON.stringify({
      schema_version: 1,
      book_id: book.book_id,
      updated_at: book.updated_at,
      metadata: book.metadata,
      publishing: book.publishing,
      alias: book.alias ?? null,
      resources: book.resources,
      structure: [...contentEntries(book.blocks)].flatMap(({ node }) =>
        "type" in node && node.type === "heading"
          ? [
              {
                block_id: node.id,
                display_level: node.level,
                title_markdown: inlineEditorText(node.content, book),
                include_in_toc: node.include_in_toc,
                starts_page: node.starts_page,
                exclude_from_numbering: node.exclude_from_numbering,
                ...(node.source_number
                  ? { source_number: node.source_number }
                  : {}),
                ...(node.alias ? { alias: node.alias } : {}),
              },
            ]
          : [],
      ),
    }) + "\n",
    { mode: 0o600 },
  );
}

export async function readDraftBlockView(
  draftRoot: string,
  bookId: number,
  updatedAt: number,
  blockId: string,
): Promise<{ node: unknown; kind: string }> {
  const root = resolve(draftRoot, "views", String(updatedAt));
  const index = JSON.parse(
    await readFile(resolve(root, "index.json"), "utf8"),
  ) as {
    book_id: number;
    updated_at: number;
    index: Record<string, { offset: number; length: number; kind: string }>;
  };
  const entry = index.index[blockId];
  if (index.book_id !== bookId || index.updated_at !== updatedAt || !entry)
    throw new Error("DRAFT_BLOCK_NOT_FOUND");
  if (
    !Number.isSafeInteger(entry.offset) ||
    entry.offset < 0 ||
    !Number.isSafeInteger(entry.length) ||
    entry.length <= 0 ||
    entry.length > 8 * 1024 * 1024
  )
    throw new Error("DRAFT_BLOCK_TOO_LARGE");
  const handle = await open(resolve(root, "blocks.ndjson"), "r");
  try {
    const buffer = Buffer.alloc(entry.length);
    let read = 0;
    while (read < buffer.length) {
      const result = await handle.read(
        buffer,
        read,
        buffer.length - read,
        entry.offset + read,
      );
      if (!result.bytesRead) throw new Error("DRAFT_BLOCK_VIEW_INVALID");
      read += result.bytesRead;
    }
    const node = JSON.parse(buffer.toString("utf8")) as { id?: string };
    if (node.id !== blockId) throw new Error("DRAFT_BLOCK_VIEW_INVALID");
    return { node, kind: entry.kind };
  } finally {
    await handle.close();
  }
}
