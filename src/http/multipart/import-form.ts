import { Readable } from "node:stream";
import { basename } from "node:path";

import Busboy, {
  type BusboyFileStream,
  type BusboyHeaders,
} from "@fastify/busboy";
import type Database from "better-sqlite3";

import { createPublishingImportServer } from "@/composition/server/publishing-imports";
import { SafeApplicationError } from "@/domain/errors";
import { hasControlCharacters } from "@/domain/text";
import {
  importUploadIdempotencyOperation,
  m1ImportExpiryMs,
  maximumUploadBytes,
} from "@/modules/publishing/application/publishing-api";
import type { StorageLayout } from "@/platform/filesystem/storage-layout";

type PublishingServer = ReturnType<typeof createPublishingImportServer>;
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
  const publishing = createPublishingImportServer(input.database);
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

  let resolveValidation!: () => void;
  let rejectValidation!: (reason: unknown) => void;
  const formValidated = new Promise<void>((resolve, reject) => {
    resolveValidation = resolve;
    rejectValidation = reject;
  });
  void formValidated.catch(() => undefined);
  let fileResult: Promise<ImportUploadResult> | undefined;
  let activeFile: BusboyFileStream | undefined;
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
        fields: 0,
        fileSize: maximumUploadBytes,
        files: 1,
        headerPairs: 100,
        headerSize: 16 * 1024,
        parts: 1,
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
      stream.on("error", () => fail(multipartError()));
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
      activeFile = stream;
      let originalName: string;
      try {
        originalName = cleanedUploadName(filename);
      } catch (error) {
        fail(error);
        stream.resume();
        return;
      }
      fileResult = publishing.storeImport(input.layout).store({
        formValidated,
        bytes: fileBytes(stream),
        expiresAtMs: m1ImportExpiryMs,
        idempotencyKey: input.idempotencyKey,
        nowMs: Date.now(),
        originalName,
        signal: input.request.signal,
      });
      void fileResult.catch(fail);
    });
    parser.on("field", () =>
      fail(multipartError("Unexpected multipart field.")),
    );
    parser.on("filesLimit", () =>
      fail(multipartError("Exactly one ZIP file is allowed.")),
    );
    parser.on("fieldsLimit", () =>
      fail(multipartError("Too many multipart fields were supplied.")),
    );
    parser.on("partsLimit", () =>
      fail(multipartError("Too many multipart parts were supplied.")),
    );
    parser.on("error", () => {
      const error = multipartError();
      activeFile?.destroy(error);
      rejectValidation(error);
      if (fileResult)
        void fileResult.catch(() => undefined).then(() => reject(error));
      else reject(error);
    });
    parser.on("finish", () => {
      if (parsingError || !fileSeen || !fileResult) {
        const error = parsingError ?? multipartError();
        rejectValidation(error);
        if (fileResult)
          void fileResult.catch(() => undefined).then(() => reject(error));
        else reject(error);
        return;
      }
      resolveValidation();
      void fileResult.then(resolve, reject);
    });
  });
  input.request.signal.addEventListener(
    "abort",
    () => parser.destroy(new Error("UPLOAD_CANCELED")),
    { once: true },
  );
  const source = Readable.fromWeb(
    input.request.body as unknown as import("node:stream/web").ReadableStream,
  );
  source.on("error", () => parser.destroy(multipartError()));
  if (input.request.signal.aborted) parser.destroy(multipartError());
  else source.pipe(parser);
  return finished;
}
