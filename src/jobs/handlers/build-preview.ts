import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import type Database from "better-sqlite3";

import { normalizeDocumentBlocks } from "../../compiler/document/normalize.js";
import { parseMarkdownDocument } from "../../compiler/document/parser.js";
import type { ContentRole } from "../../compiler/document/structure-proposal.js";
import { renderDraftPreview } from "../../compiler/render/preview.js";
import { inspectRasterImage } from "../../compiler/resources/images.js";
import { resolveDocumentResources } from "../../compiler/resources/resolver.js";
import { DraftRepository } from "../../db/repositories/drafts.js";
import { createOpaqueId } from "../../domain/ids.js";
import { parseBookConfigYaml } from "../../schemas/book-config.js";
import { atomicWriteFile, resolveContainedPath } from "../../storage/layout.js";
import type { StorageLayout } from "../../storage/layout.js";

export const previewBuildVersion = "draft-preview-v1";
export const previewBuildArtifactFilename = "preview-build-result.json";

export interface PreviewBuildArtifact {
  readonly diagnosticsRelativePath: string;
  readonly previewRelativePath: "preview";
  readonly version: typeof previewBuildVersion;
}

interface ConfigStructureNode {
  readonly block_id: string;
  readonly display_level: number;
  readonly display_title?: string;
  readonly include_in_toc: boolean;
  readonly role?: ContentRole;
  readonly starts_page: boolean;
}

function structureNodes(
  config: Readonly<Record<string, unknown>>,
): readonly ConfigStructureNode[] {
  return config.structure as ConfigStructureNode[];
}

function dataRelativePath(root: string, target: string): string {
  const result = relative(root, target).split(sep).join("/");
  if (!result || result === ".." || result.startsWith("../")) {
    throw new Error("PREVIEW_STORAGE_PATH_INVALID");
  }
  return result;
}

export async function buildPreview(input: {
  readonly bookId: number;
  readonly configRevision: number;
  readonly configYamlPath: string;
  readonly sourceRoot: string;
  readonly stagingDirectory: string;
}): Promise<PreviewBuildArtifact> {
  const stagingDirectory = resolve(input.stagingDirectory);
  const previewDirectory = resolve(stagingDirectory, "preview");
  try {
    await mkdir(resolve(stagingDirectory, ".."), {
      mode: 0o700,
      recursive: true,
    });
    await mkdir(stagingDirectory, { mode: 0o700, recursive: false });
    await mkdir(previewDirectory, { mode: 0o700, recursive: false });
    const config = parseBookConfigYaml(
      await readFile(input.configYamlPath, "utf8"),
    );
    if (
      config.book_id !== input.bookId ||
      config.revision !== input.configRevision
    ) {
      throw new Error("PREVIEW_CONFIG_CAPTURE_MISMATCH");
    }
    const source = config.source as Readonly<Record<string, unknown>>;
    const mainMarkdown = String(source.main_markdown);
    const markdownPath = await resolveContainedPath(
      input.sourceRoot,
      mainMarkdown,
    );
    const markdownBytes = await readFile(markdownPath);
    if (
      createHash("sha256").update(markdownBytes).digest("hex") !==
      source.main_markdown_sha256
    ) {
      throw new Error("PREVIEW_SOURCE_HASH_MISMATCH");
    }
    const document = parseMarkdownDocument(markdownBytes);
    const configuredStructure = structureNodes(config);
    let headingIndex = 0;
    const normalized = normalizeDocumentBlocks(document, {
      idFactory(node) {
        if (node.type === "heading") {
          const configured = configuredStructure[headingIndex++];
          if (!configured) throw new Error("PREVIEW_HEADING_COUNT_MISMATCH");
          return configured.block_id;
        }
        return createOpaqueId("block");
      },
    });
    if (headingIndex !== configuredStructure.length) {
      throw new Error("PREVIEW_HEADING_COUNT_MISMATCH");
    }
    const resolution = await resolveDocumentResources({
      document,
      markdownPath,
      resourceRoot: input.sourceRoot,
    });
    if (resolution.diagnostics.length > 0) {
      throw new Error("PREVIEW_RESOURCE_CLOSURE_FAILED");
    }
    const assetsDirectory = resolve(previewDirectory, "assets");
    await mkdir(assetsDirectory, { mode: 0o700 });
    for (const resource of resolution.resources) {
      const bytes = await readFile(resource.absolutePath);
      await inspectRasterImage({
        bytes,
        filename: resource.relativePath,
      });
      await atomicWriteFile(resolve(assetsDirectory, resource.id), bytes, {
        mode: 0o600,
      });
    }
    const html = await renderDraftPreview({
      authenticatedResourceUrl: (resourceId) =>
        `/api/manage/books/${input.bookId}/preview/${input.configRevision}/assets/${resourceId}`,
      document,
      resourceResolution: resolution,
    });
    const pagesDirectory = resolve(previewDirectory, "pages");
    await mkdir(pagesDirectory, { mode: 0o700 });
    await atomicWriteFile(resolve(pagesDirectory, "1.html"), html, {
      mode: 0o600,
    });

    let inheritedRole: ContentRole = "body";
    const headings = normalized.headings.map((heading, index) => {
      const configured = configuredStructure[index];
      if (!configured) throw new Error("PREVIEW_HEADING_COUNT_MISMATCH");
      if (configured.role) inheritedRole = configured.role;
      return Object.freeze({
        block_id: heading.blockId,
        display_level: configured.display_level,
        include_in_toc: configured.include_in_toc,
        role: inheritedRole,
        source_level: heading.level,
        source_title: heading.sourceTitle,
        starts_page: configured.starts_page,
        title: configured.display_title ?? heading.sourceTitle,
      });
    });
    const model = Object.freeze({
      config_revision: input.configRevision,
      headings,
      pages: [
        {
          page_id: 1,
          title:
            headings.find((heading) => heading.starts_page)?.title ??
            String(config.title),
        },
      ],
      version: previewBuildVersion,
    });
    const diagnosticsPath = resolve(previewDirectory, "diagnostics.json");
    await atomicWriteFile(
      diagnosticsPath,
      `${JSON.stringify({ diagnostics: [] })}\n`,
      { mode: 0o600 },
    );
    await atomicWriteFile(
      resolve(previewDirectory, "preview-model.json"),
      `${JSON.stringify(model)}\n`,
      { mode: 0o600 },
    );
    const artifact: PreviewBuildArtifact = Object.freeze({
      diagnosticsRelativePath: "diagnostics.json",
      previewRelativePath: "preview",
      version: previewBuildVersion,
    });
    await atomicWriteFile(
      resolve(stagingDirectory, previewBuildArtifactFilename),
      `${JSON.stringify(artifact)}\n`,
      { mode: 0o600 },
    );
    return artifact;
  } catch (error) {
    await rm(stagingDirectory, { force: true, recursive: true });
    throw error;
  }
}

export async function finalizeBuiltPreview(input: {
  readonly artifact: PreviewBuildArtifact;
  readonly bookId: number;
  readonly configRevision: number;
  readonly database: Database.Database;
  readonly layout: StorageLayout;
  readonly nowMs: number;
  readonly stagingDirectory: string;
}): Promise<void> {
  if (input.artifact.version !== previewBuildVersion) {
    throw new Error("PREVIEW_BUILD_ARTIFACT_INVALID");
  }
  const finalDirectory = resolve(
    input.layout.bookDirectory,
    String(input.bookId),
    "draft",
    "previews",
    String(input.configRevision),
  );
  const stagedPreviewDirectory = await resolveContainedPath(
    input.stagingDirectory,
    input.artifact.previewRelativePath,
  );
  await mkdir(resolve(finalDirectory, ".."), { mode: 0o700, recursive: true });
  try {
    await rename(stagedPreviewDirectory, finalDirectory);
    const diagnosticsPath = resolve(
      finalDirectory,
      input.artifact.diagnosticsRelativePath,
    );
    new DraftRepository(input.database).completePreview({
      bookId: input.bookId,
      configRevision: input.configRevision,
      diagnosticsRelativePath: dataRelativePath(
        input.layout.root,
        diagnosticsPath,
      ),
      nowMs: input.nowMs,
      previewRelativePath: dataRelativePath(input.layout.root, finalDirectory),
    });
  } catch (error) {
    await rm(finalDirectory, { force: true, recursive: true });
    throw error;
  }
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
