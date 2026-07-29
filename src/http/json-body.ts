import { SafeApplicationError } from "@/domain/errors";

export async function readBoundedJson(
  request: Request,
  maximumBytes = 4 * 1024 * 1024,
): Promise<unknown> {
  if (
    request.headers.get("content-type")?.split(";", 1)[0]?.trim() !==
    "application/json"
  ) {
    throw new SafeApplicationError(
      "CONTENT_TYPE_UNSUPPORTED",
      "The request must contain JSON.",
      400,
    );
  }
  const reader = request.body?.getReader();
  if (!reader) {
    throw new SafeApplicationError(
      "REQUEST_BODY_INVALID",
      "The request body is required.",
      400,
    );
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      throw new SafeApplicationError(
        "REQUEST_BODY_TOO_LARGE",
        "The request body is too large.",
        413,
      );
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new SafeApplicationError(
      "REQUEST_BODY_INVALID",
      "The request body is not valid UTF-8 JSON.",
      400,
    );
  }
}
