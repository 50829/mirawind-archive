import { Readable } from "node:stream";
import { basename } from "node:path";

import Busboy, {
  type BusboyFileStream,
  type BusboyHeaders,
} from "@fastify/busboy";
import type Database from "better-sqlite3";

import { createPublishingServer } from "@/composition/server";
import { SafeApplicationError } from "@/domain/errors";
import { hasControlCharacters } from "@/domain/text";
import {
  importUploadIdempotencyOperation,
  m1ImportExpiryMs,
  maximumUploadBytes,
} from "@/modules/publishing/application/public";
import type { StorageLayout } from "@/platform/filesystem/layout";

type PublishingServer = ReturnType<typeof createPublishingServer>;
type ImportStore = ReturnType<PublishingServer["storeImport"]>;
type ImportUploadResult = Awaited<ReturnType<ImportStore["store"]>>;

function multipartError(message = "The multipart upload is invalid.") {
  return new SafeApplicationError("INVALID_MULTIPART", message, 400);
}

function cleanedUploadName(filename: string): string {
  const name = basename(filename.replaceAll("\\", "/")).normalize("NFC").trim();
  if (
    [...name].length < 1 ||
    [...name].length > 255 ||
    hasControlCharacters(name)
  ) {
    throw multipartError("The ZIP filename is invalid.");
  }
  return name;
}

async function* fileBytes(stream: BusboyFileStream): AsyncIterable<Uint8Array> {
  for await (const chunk of stream) {
    if (!(chunk instanceof Uint8Array)) throw multipartError();
    yield chunk;
  }
  if (stream.truncated) {
    throw new SafeApplicationError(
      "UPLOAD_SIZE_LIMIT",
      "The upload exceeds the 2 GiB limit.",
      413,
    );
  }
}

export async function storeMultipartImport(input: {
  readonly database: Database.Database;
  readonly idempotencyKey: string;
  readonly layout: StorageLayout;
  readonly request: Request;
}): Promise<ImportUploadResult> {
  const publishing = createPublishingServer(input.database);
  const existing = publishing.findJobByIdempotency(
    importUploadIdempotencyOperation,
    input.idempotencyKey,
  );
  if (existing?.importId) {
    await input.request.body
      ?.cancel("idempotent-replay")
      .catch(() => undefined);
    return Object.freeze({
      import: publishing.requireImport(existing.importId),
      job: existing,
    });
  }
  if (!input.request.body)
    throw multipartError("A multipart body is required.");

  let resolveTargetBook!: (value: number | undefined) => void;
  let rejectTargetBook!: (reason: unknown) => void;
  const targetBook = new Promise<number | undefined>((resolve, reject) => {
    resolveTargetBook = resolve;
    rejectTargetBook = reject;
  });
  void targetBook.catch(() => undefined);
  let targetBookId: number | undefined;
  let targetSeen = false;
  let fileResult: Promise<ImportUploadResult> | undefined;
  let parsingError: unknown;
  let fileSeen = false;
  const contentType = input.request.headers.get("content-type");
  if (!contentType) throw multipartError();
  let parser: Busboy;
  try {
    parser = new Busboy({
      headers: {
        "content-type": contentType,
      } as BusboyHeaders,
      limits: {
        fieldNameSize: 100,
        fieldSize: 32,
        fields: 1,
        fileSize: maximumUploadBytes,
        files: 1,
        headerPairs: 100,
        headerSize: 16 * 1024,
        parts: 2,
      },
      preservePath: false,
    });
  } catch (error) {
    throw multipartError(
      error instanceof Error ? "The multipart boundary is invalid." : undefined,
    );
  }

  const finished = new Promise<ImportUploadResult>((resolve, reject) => {
    const fail = (error: unknown) => {
      parsingError ??= error;
    };
    parser.on("file", (fieldName, stream, filename, _encoding, mimeType) => {
      if (
        fileSeen ||
        fieldName !== "file" ||
        !["application/zip", "application/octet-stream"].includes(mimeType)
      ) {
        fail(multipartError("Exactly one ZIP file field is required."));
        stream.resume();
        return;
      }
      fileSeen = true;
      let originalName: string;
      try {
        originalName = cleanedUploadName(filename);
      } catch (error) {
        fail(error);
        stream.resume();
        return;
      }
      fileResult = publishing.storeImport(input.layout).store({
        bookId: targetBook,
        bytes: fileBytes(stream),
        expiresAtMs: m1ImportExpiryMs,
        idempotencyKey: input.idempotencyKey,
        nowMs: Date.now(),
        originalName,
        signal: input.request.signal,
      });
      void fileResult.catch(fail);
    });
    parser.on("field", (fieldName, value, _nameCut, valueCut) => {
      if (targetSeen || fieldName !== "target_book_id" || valueCut) {
        fail(multipartError("The target book field is invalid."));
        return;
      }
      targetSeen = true;
      if (value.trim() === "") return;
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < 1) {
        fail(multipartError("The target book ID is invalid."));
        return;
      }
      targetBookId = parsed;
    });
    parser.on("filesLimit", () =>
      fail(multipartError("Exactly one ZIP file is allowed.")),
    );
    parser.on("fieldsLimit", () =>
      fail(multipartError("Too many multipart fields were supplied.")),
    );
    parser.on("partsLimit", () =>
      fail(multipartError("Too many multipart parts were supplied.")),
    );
    parser.on("error", () => fail(multipartError()));
    parser.on("finish", () => {
      if (targetBookId !== undefined && !publishing.findBook(targetBookId)) {
        fail(multipartError("The target book does not exist."));
      }
      if (parsingError || !fileSeen || !fileResult) {
        const error = parsingError ?? multipartError();
        rejectTargetBook(error);
        reject(error);
        return;
      }
      resolveTargetBook(targetBookId);
      void fileResult.then(resolve, reject);
    });
  });
  input.request.signal.addEventListener(
    "abort",
    () => parser.destroy(new Error("UPLOAD_CANCELED")),
    { once: true },
  );
  Readable.fromWeb(
    input.request.body as unknown as import("node:stream/web").ReadableStream,
  ).pipe(parser);
  return finished;
}
