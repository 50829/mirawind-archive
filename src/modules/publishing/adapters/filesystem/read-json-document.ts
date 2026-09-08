import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { JSONParser, TokenType } from "@streamparser/json";

import { SafeApplicationError } from "@/domain/errors";
import { contentLimits } from "../../core/content/book-document";

export async function readJsonDocument(
  path: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const metadata = await lstat(path);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size > contentLimits.bytes
  )
    throw new SafeApplicationError(
      "CONTENT_FILE_INVALID",
      "The document file is invalid or too large.",
      400,
    );
  const parser = new JSONParser({
    paths: ["$"],
    emitPartialTokens: true,
    stringBufferSize: 65536,
    numberBufferSize: 65536,
  });
  let result: unknown;
  let bytes = 0;
  let depth = 0;
  let tokens = 0;
  const objects: ({ keys: Set<string>; expectKey: boolean } | null)[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  parser.onValue = ({ value }) => {
    result = value;
  };
  parser.onToken = ({ token, value, partial }) => {
    if (typeof value === "string" && value.length > contentLimits.blockBytes)
      throw new Error("CONTENT_STRING_LIMIT_EXCEEDED");
    if (partial) return;
    const object = objects.at(-1);
    if (token === TokenType.STRING && object?.expectKey) {
      const key = String(value);
      if (
        object.keys.has(key) ||
        ["__proto__", "constructor", "prototype"].includes(key)
      )
        throw new Error("CONTENT_JSON_KEY_INVALID");
      object.keys.add(key);
      object.expectKey = false;
    }
    if (token === TokenType.COMMA && object) object.expectKey = true;
    if (++tokens > contentLimits.nodes * 12)
      throw new Error("CONTENT_NODE_LIMIT_EXCEEDED");
    if (token === TokenType.LEFT_BRACE || token === TokenType.LEFT_BRACKET) {
      if (++depth > contentLimits.depth)
        throw new Error("CONTENT_DEPTH_LIMIT_EXCEEDED");
      objects.push(
        token === TokenType.LEFT_BRACE
          ? { keys: new Set(), expectKey: true }
          : null,
      );
    } else if (
      token === TokenType.RIGHT_BRACE ||
      token === TokenType.RIGHT_BRACKET
    ) {
      depth--;
      objects.pop();
    }
  };
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const stream = handle.createReadStream({
    highWaterMark: 65536,
    ...(signal ? { signal } : {}),
  });
  try {
    for await (const chunk of stream) {
      bytes += chunk.byteLength;
      if (bytes > contentLimits.bytes)
        throw new Error("CONTENT_FILE_LIMIT_EXCEEDED");
      decoder.decode(chunk, { stream: true });
      parser.write(chunk);
    }
    decoder.decode();
    if (!parser.isEnded) parser.end();
    if (depth !== 0 || result === undefined)
      throw new Error("CONTENT_JSON_INVALID");
    return result;
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new SafeApplicationError(
      "CONTENT_JSON_INVALID",
      "The document is malformed or exceeds content limits.",
      400,
      { cause: error },
    );
  } finally {
    stream.destroy();
  }
}
