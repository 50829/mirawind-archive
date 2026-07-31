import { SafeApplicationError } from "@/domain/errors";

export type BookAccess = "private" | "public";

export interface BookAccessPort {
  setAccess(input: {
    readonly access: BookAccess;
    readonly actorUserId: string | null;
    readonly bookId: number;
    readonly nowMs: number;
  }): "not_found" | "publication_required" | "updated";
}

export function setBookAccess(input: {
  readonly access: BookAccess;
  readonly actorUserId: string | null;
  readonly bookId: number;
  readonly books: BookAccessPort;
  readonly nowMs: number;
}): void {
  const result = input.books.setAccess(input);
  if (result === "publication_required") {
    throw new SafeApplicationError(
      "BOOK_PUBLICATION_REQUIRED",
      "The book must have a published version before it can be public.",
      409,
    );
  }
  if (result === "not_found") {
    throw new SafeApplicationError("NOT_FOUND", "The book was not found.", 404);
  }
}
