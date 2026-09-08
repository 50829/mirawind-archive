import type Database from "better-sqlite3";
import type { StorageLayout } from "@/platform/filesystem/storage-layout";
import { SafeApplicationError } from "@/domain/errors";
import { DraftRepository } from "../sqlite/drafts";
import { DraftArtifactReader } from "./draft-artifacts";
import { readDraftBlockView } from "./draft-views";
import { blockEditorText } from "../../core/content/editor-text";
import type {
  ContentBlock,
  ListItem,
} from "../../core/content/book-document.generated";
import { bookStorageRoot } from "./draft-document";
import { resolve } from "node:path";
import { queueDraftSave } from "./queue-draft-save";

export async function getDraftBlock(input: {
  readonly bookId: number;
  readonly blockId: string;
  readonly database: Database.Database;
  readonly layout: StorageLayout;
}) {
  const book = new DraftRepository(input.database).findBook(input.bookId);
  if (!book?.draftImportId)
    throw new SafeApplicationError(
      "NOT_FOUND",
      "The draft block was not found.",
      404,
    );
  const view = await new DraftArtifactReader(input.layout).readDraftView(
    input.bookId,
  );
  const entry = await readDraftBlockView(
    resolve(bookStorageRoot(input.layout, input.bookId), "draft"),
    input.bookId,
    view.updated_at,
    input.blockId,
  );
  return {
    block_id: input.blockId,
    updated_at: view.updated_at,
    kind: entry.kind,
    markdown: blockEditorText(entry.node as ContentBlock | ListItem, {
      resources: [...view.resources],
    }),
  };
}
export function patchDraftBlock(input: {
  readonly bookId: number;
  readonly blockId: string;
  readonly database: Database.Database;
  readonly layout: StorageLayout;
  readonly expectedUpdatedAt: number;
  readonly markdown: string;
  readonly nowMs: number;
}) {
  return queueDraftSave({
    ...input,
    patch: { block: { block_id: input.blockId, markdown: input.markdown } },
  });
}
