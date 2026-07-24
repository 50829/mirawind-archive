import { extname } from "node:path";

function safeTitle(value: string): string {
  const normalized = value
    .normalize("NFC")
    .replaceAll(/[/\\]/gu, " ")
    .split("")
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? " " : character;
    })
    .join("")
    .replaceAll(/[";]/gu, "")
    .replaceAll(/\s+/gu, " ")
    .trim();
  return [...normalized].slice(0, 180).join("") || "book";
}

function safeExtension(originalName: string, mediaType: string): string {
  const extension = extname(originalName).toLowerCase();
  if (extension === ".zip" || mediaType === "application/zip") return ".zip";
  if (extension === ".pdf" || mediaType === "application/pdf") return ".pdf";
  if (extension === ".epub" || mediaType === "application/epub+zip") {
    return ".epub";
  }
  return ".bin";
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replaceAll(
    /[!'()*]/gu,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
}

export function originalDownloadFilename(input: {
  readonly bookId: number;
  readonly mediaType: string;
  readonly originalName: string;
  readonly title: string;
}): {
  readonly ascii: string;
  readonly contentDisposition: string;
  readonly utf8: string;
} {
  const extension = safeExtension(input.originalName, input.mediaType);
  const suffix = extension === ".zip" ? "-mineru" : "";
  const utf8 = `${safeTitle(input.title)}${suffix}${extension}`;
  const ascii = `book-${input.bookId}${extension}`;
  return Object.freeze({
    ascii,
    contentDisposition: `attachment; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(utf8)}`,
    utf8,
  });
}
