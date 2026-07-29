import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  SafeApplicationError,
  createSafeDiagnostic,
  type SafeDiagnostic,
} from "@/domain/errors";
import { parseBookConfigYaml } from "@/modules/publishing/application/public";
import {
  resolveContainedPath,
  type StorageLayout,
} from "@/platform/filesystem/layout";

function hidden(message: string): never {
  throw new SafeApplicationError("NOT_FOUND", message, 404);
}

function previewResourceMediaType(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  const prefix = Buffer.from(bytes.subarray(0, 12)).toString("ascii");
  if (prefix.startsWith("GIF87a") || prefix.startsWith("GIF89a")) {
    return "image/gif";
  }
  if (prefix.startsWith("RIFF") && prefix.slice(8, 12) === "WEBP") {
    return "image/webp";
  }
  return "application/octet-stream";
}

export class DraftArtifactReader {
  constructor(private readonly layout: StorageLayout) {}

  async readBookConfig(relativePath: string): Promise<Record<string, unknown>> {
    const yaml = await readFile(
      await resolveContainedPath(this.layout.root, relativePath),
      "utf8",
    );
    return parseBookConfigYaml(yaml) as Record<string, unknown>;
  }

  async readPreviewModel(
    previewRelativePath: string,
  ): Promise<Record<string, unknown>> {
    const previewRoot = await resolveContainedPath(
      this.layout.root,
      previewRelativePath,
    );
    return JSON.parse(
      await readFile(resolve(previewRoot, "preview-model.json"), "utf8"),
    ) as Record<string, unknown>;
  }

  async readDiagnostics(
    relativePath: string,
  ): Promise<readonly SafeDiagnostic[]> {
    const parsed = JSON.parse(
      await readFile(
        await resolveContainedPath(this.layout.root, relativePath),
        "utf8",
      ),
    ) as { diagnostics?: unknown };
    if (!Array.isArray(parsed.diagnostics)) return [];
    return parsed.diagnostics
      .filter((value): value is SafeDiagnostic =>
        Boolean(
          value &&
          typeof value === "object" &&
          typeof (value as Record<string, unknown>).code === "string" &&
          typeof (value as Record<string, unknown>).message === "string",
        ),
      )
      .slice(0, 10_000)
      .map(createSafeDiagnostic);
  }

  async readPreviewPage(input: {
    readonly pageId: number;
    readonly previewRelativePath: string;
  }): Promise<string> {
    try {
      const previewRoot = await resolveContainedPath(
        this.layout.root,
        input.previewRelativePath,
      );
      return await readFile(
        resolve(previewRoot, "pages", `${input.pageId}.html`),
        "utf8",
      );
    } catch {
      return hidden("The preview was not found.");
    }
  }

  async readPreviewResource(input: {
    readonly previewRelativePath: string;
    readonly resourceId: string;
  }): Promise<{
    readonly bytes: Uint8Array;
    readonly mediaType: string;
  }> {
    try {
      const previewRoot = await resolveContainedPath(
        this.layout.root,
        input.previewRelativePath,
      );
      const bytes = await readFile(
        resolve(previewRoot, "assets", input.resourceId),
      );
      return Object.freeze({
        bytes,
        mediaType: previewResourceMediaType(bytes),
      });
    } catch {
      return hidden("The asset was not found.");
    }
  }
}
