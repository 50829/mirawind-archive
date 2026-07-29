import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { SemanticCompilationIdentity } from "@/modules/publishing/core/preparation/document-model";

export const previewBuildVersion = "draft-preview-v4";
export const previewBuildArtifactFilename = "preview-build-result.json";

export interface PreviewBuildArtifact {
  readonly diagnosticsRelativePath: string;
  readonly identity: SemanticCompilationIdentity;
  readonly previewRelativePath: "preview";
  readonly version: typeof previewBuildVersion;
}

export function previewArtifactPath(stagingDirectory: string): string {
  return resolve(stagingDirectory, previewBuildArtifactFilename);
}

export async function readPreviewBuildArtifact(
  stagingDirectory: string,
): Promise<PreviewBuildArtifact> {
  const parsed: unknown = JSON.parse(
    await readFile(previewArtifactPath(stagingDirectory), "utf8"),
  );
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as Record<string, unknown>).version !== previewBuildVersion ||
    (parsed as Record<string, unknown>).previewRelativePath !== "preview" ||
    (parsed as Record<string, unknown>).diagnosticsRelativePath !==
      "diagnostics.json"
  ) {
    throw new Error("PREVIEW_BUILD_ARTIFACT_INVALID");
  }
  return parsed as PreviewBuildArtifact;
}
