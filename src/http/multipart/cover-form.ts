import { basename } from "node:path";
import { Readable } from "node:stream";

import Busboy, {
  type BusboyFileStream,
  type BusboyHeaders,
} from "@fastify/busboy";

import { SafeApplicationError } from "@/domain/errors";
import { hasControlCharacters } from "@/domain/text";
import { maximumCoverUploadBytes } from "@/modules/publishing/application/publishing-api";

function invalidCover(message = "The cover upload is invalid.") {
  return new SafeApplicationError("INVALID_COVER_UPLOAD", message, 400);
}

function cleanFilename(value: string): string {
  const filename = basename(value.replaceAll("\\", "/"))
    .normalize("NFC")
    .trim();
  if (
    filename.length < 1 ||
    Buffer.byteLength(filename, "utf8") > 255 ||
    hasControlCharacters(filename)
  ) {
    throw invalidCover("The cover filename is invalid.");
  }
  return filename;
}

async function collectFile(stream: BusboyFileStream): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    if (!(chunk instanceof Uint8Array)) throw invalidCover();
    total += chunk.byteLength;
    if (total > maximumCoverUploadBytes) {
      throw new SafeApplicationError(
        "COVER_SIZE_LIMIT",
        "The cover exceeds the 20 MiB limit.",
        413,
      );
    }
    chunks.push(Buffer.from(chunk));
  }
  if (stream.truncated) {
    throw new SafeApplicationError(
      "COVER_SIZE_LIMIT",
      "The cover exceeds the 20 MiB limit.",
      413,
    );
  }
  return Buffer.concat(chunks, total);
}

export async function readMultipartCover(request: Request): Promise<{
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly expectedUpdatedAt: number;
}> {
  if (!request.body) throw invalidCover("A multipart body is required.");
  const contentType = request.headers.get("content-type");
  if (!contentType) throw invalidCover();
  let parser: Busboy;
  try {
    parser = new Busboy({
      headers: { "content-type": contentType } as BusboyHeaders,
      limits: {
        fieldNameSize: 100,
        fields: 1,
        fieldSize: 32,
        fileSize: maximumCoverUploadBytes,
        files: 1,
        headerPairs: 100,
        headerSize: 16 * 1024,
        parts: 2,
      },
      preservePath: false,
    });
  } catch {
    throw invalidCover("The multipart boundary is invalid.");
  }
  let filePromise: Promise<Uint8Array> | undefined;
  let filename: string | undefined;
  let expectedUpdatedAt: number | undefined;
  let failure: unknown;
  const finished = new Promise<void>((resolveFinished, rejectFinished) => {
    const fail = (error: unknown) => {
      failure ??= error;
    };
    parser.on("file", (fieldName, stream, name, _encoding, mediaType) => {
      if (
        filePromise ||
        fieldName !== "file" ||
        ![
          "application/octet-stream",
          "image/gif",
          "image/jpeg",
          "image/png",
          "image/webp",
        ].includes(mediaType)
      ) {
        fail(invalidCover("Exactly one raster image is required."));
        stream.resume();
        return;
      }
      try {
        filename = cleanFilename(name);
      } catch (error) {
        fail(error);
        stream.resume();
        return;
      }
      filePromise = collectFile(stream);
      void filePromise.catch(fail);
    });
    parser.on("field", (name, value, nameTruncated, valueTruncated) => {
      if (
        name !== "expected_updated_at" ||
        expectedUpdatedAt !== undefined ||
        nameTruncated ||
        valueTruncated ||
        !/^(?:0|[1-9][0-9]*)$/u.test(value) ||
        !Number.isSafeInteger(Number(value))
      )
        return fail(invalidCover("A draft timestamp is required."));
      expectedUpdatedAt = Number(value);
    });
    parser.on("filesLimit", () => fail(invalidCover()));
    parser.on("fieldsLimit", () => fail(invalidCover()));
    parser.on("partsLimit", () => fail(invalidCover()));
    parser.on("error", () => rejectFinished(invalidCover()));
    parser.on("finish", () => {
      if (
        failure ||
        !filePromise ||
        !filename ||
        expectedUpdatedAt === undefined
      ) {
        rejectFinished(failure ?? invalidCover());
        return;
      }
      resolveFinished();
    });
  });
  request.signal.addEventListener(
    "abort",
    () => parser.destroy(new Error("UPLOAD_CANCELED")),
    { once: true },
  );
  Readable.fromWeb(
    request.body as unknown as import("node:stream/web").ReadableStream,
  ).pipe(parser);
  await finished;
  if (!filePromise || !filename || expectedUpdatedAt === undefined)
    throw invalidCover();
  return Object.freeze({
    bytes: await filePromise,
    filename,
    expectedUpdatedAt,
  });
}
