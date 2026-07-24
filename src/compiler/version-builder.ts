import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import {
  buildDocumentManifest,
  canonicalJson,
  compilerIdentity,
  type ManifestResource,
  type ManifestSourceFile,
} from "./document/manifest.js";
import { normalizeDocumentBlocks } from "./document/normalize.js";
import { numberConfiguredHeadings } from "./document/numbering.js";
import { parseMarkdownDocument } from "./document/parser.js";
import { splitDocumentPages } from "./document/pages.js";
import { validateDocumentConfig } from "./document/validate-config.js";
import { renderSemanticDocument } from "./render/document.js";
import { inspectRasterImage } from "./resources/images.js";
import { resolveDocumentResources } from "./resources/resolver.js";
import { toIsoDateTime } from "../domain/time.js";
import { parseBookConfigYaml } from "../schemas/book-config.js";
import {
  validateDocumentManifest,
  validateVersionMarker,
} from "../schemas/document-manifest.js";
import { atomicWriteFile, resolveContainedPath } from "../storage/layout.js";

export const versionBuildArtifactFilename = "version-build-result.json";

export interface VersionBuildArtifact {
  readonly bookId: number;
  readonly configRevision: number;
  readonly manifestSha256: string;
  readonly versionDirectory: "version";
  readonly versionId: string;
}

interface FileDescriptor {
  readonly absolutePath: string;
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}

function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function digestFile(
  path: string,
): Promise<{ readonly sha256: string; readonly size: number }> {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    const bytes = chunk as Buffer;
    size += bytes.byteLength;
    hash.update(bytes);
  }
  return Object.freeze({ sha256: hash.digest("hex"), size });
}

function opaqueBuildId(
  prefix: "blk" | "res",
  versionId: string,
  ordinal: number,
): string {
  return `${prefix}_${createHash("sha256")
    .update("mirawind-version-build-id-v1\0")
    .update(versionId)
    .update("\0")
    .update(String(ordinal))
    .digest("base64url")
    .slice(0, 24)}`;
}

function mediaType(format: string): string {
  if (format === "jpeg") return "image/jpeg";
  if (format === "png") return "image/png";
  if (format === "gif") return "image/gif";
  if (format === "webp") return "image/webp";
  throw new Error("PUBLISHED_RESOURCE_FORMAT_UNSUPPORTED");
}

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function htmlDocument(input: {
  readonly body: string;
  readonly cssPath: string;
  readonly language: string;
  readonly title: string;
}): string {
  return `<!doctype html>
<html lang="${htmlEscape(input.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<title>${htmlEscape(input.title)}</title>
<link rel="stylesheet" href="${htmlEscape(input.cssPath)}">
</head>
<body><main>${input.body}</main></body>
</html>
`;
}

function relativePath(root: string, target: string): string {
  const result = relative(root, target).split(sep).join("/");
  if (
    !result ||
    result === ".." ||
    result.startsWith("../") ||
    result.includes("\\")
  ) {
    throw new Error("VERSION_PATH_OUTSIDE_ROOT");
  }
  return result;
}

async function filesUnder(root: string): Promise<readonly string[]> {
  const output: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) =>
      Buffer.from(left.name).compare(Buffer.from(right.name)),
    );
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error("VERSION_SOURCE_LINK_REJECTED");
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) output.push(path);
      else throw new Error("VERSION_SOURCE_SPECIAL_FILE_REJECTED");
      if (output.length > 1_000_000) {
        throw new Error("VERSION_FILE_COUNT_LIMIT");
      }
    }
  };
  await visit(root);
  return Object.freeze(output);
}

async function copyTree(input: {
  readonly destination: string;
  readonly source: string;
}): Promise<readonly ManifestSourceFile[]> {
  const files = await filesUnder(input.source);
  const descriptors: ManifestSourceFile[] = [];
  for (const sourcePath of files) {
    const relativeSourcePath = relativePath(input.source, sourcePath);
    const destinationPath = resolve(input.destination, relativeSourcePath);
    await mkdir(dirname(destinationPath), { mode: 0o700, recursive: true });
    await copyFile(sourcePath, destinationPath);
    await chmod(destinationPath, 0o400);
    const digest = await digestFile(destinationPath);
    descriptors.push(
      Object.freeze({
        path: `source/${relativeSourcePath}`,
        sha256: digest.sha256,
        size: digest.size,
      }),
    );
  }
  return Object.freeze(descriptors);
}

async function describeFiles(root: string): Promise<readonly FileDescriptor[]> {
  const files = await filesUnder(root);
  const descriptors: FileDescriptor[] = [];
  for (const absolutePath of files) {
    const path = relativePath(root, absolutePath);
    if (path === "version.json") continue;
    const digest = await digestFile(absolutePath);
    descriptors.push(
      Object.freeze({
        absolutePath,
        path,
        sha256: digest.sha256,
        size: digest.size,
      }),
    );
  }
  descriptors.sort((left, right) =>
    Buffer.from(left.path).compare(Buffer.from(right.path)),
  );
  return Object.freeze(descriptors);
}

function structureNodes(config: Readonly<Record<string, unknown>>) {
  return config.structure as readonly { readonly block_id: string }[];
}

export async function buildImmutableVersion(input: {
  readonly bookId: number;
  readonly configRevision: number;
  readonly configYamlPath: string;
  readonly createdAtMs: number;
  readonly draftRoot: string;
  readonly predecessorVersionId: string | null;
  readonly sourceId: string;
  readonly sourceRoot: string;
  readonly stagingDirectory: string;
  readonly versionId: string;
}): Promise<VersionBuildArtifact> {
  const stagingDirectory = resolve(input.stagingDirectory);
  const versionDirectory = resolve(stagingDirectory, "version");
  try {
    await mkdir(dirname(stagingDirectory), { mode: 0o700, recursive: true });
    await mkdir(stagingDirectory, { mode: 0o700, recursive: false });
    await mkdir(versionDirectory, { mode: 0o700, recursive: false });
    const configYaml = await readFile(input.configYamlPath, "utf8");
    const config = parseBookConfigYaml(configYaml);
    if (
      config.book_id !== input.bookId ||
      config.revision !== input.configRevision
    ) {
      throw new Error("VERSION_CONFIG_CAPTURE_MISMATCH");
    }
    const source = config.source as Readonly<Record<string, unknown>>;
    const mainMarkdownRelativePath = String(source.main_markdown);
    const markdownPath = await resolveContainedPath(
      input.sourceRoot,
      mainMarkdownRelativePath,
    );
    const markdownBytes = await readFile(markdownPath);
    if (sha256(markdownBytes) !== source.main_markdown_sha256) {
      throw new Error("VERSION_SOURCE_HASH_MISMATCH");
    }
    const configuredStructure = structureNodes(config);
    let headingIndex = 0;
    let blockOrdinal = 0;
    const document = normalizeDocumentBlocks(
      parseMarkdownDocument(markdownBytes),
      {
        idFactory(node) {
          if (node.type === "heading") {
            const heading = configuredStructure[headingIndex++];
            if (!heading) throw new Error("VERSION_HEADING_COUNT_MISMATCH");
            return heading.block_id;
          }
          return opaqueBuildId("blk", input.versionId, ++blockOrdinal);
        },
      },
    );
    if (headingIndex !== configuredStructure.length) {
      throw new Error("VERSION_HEADING_COUNT_MISMATCH");
    }
    const validated = validateDocumentConfig({ config, document });
    const publishing = config.publishing as Readonly<Record<string, unknown>>;
    const numbering = publishing.numbering as Readonly<Record<string, unknown>>;
    const headings = numberConfiguredHeadings(
      validated.headings,
      numbering.mode === "preserve" ? "preserve" : "normalized",
    );
    const pages = splitDocumentPages({
      bookTitle: String(config.title),
      document,
      headings,
    });

    let resourceOrdinal = 0;
    const resourceResolution = await resolveDocumentResources({
      document,
      idFactory: () => opaqueBuildId("res", input.versionId, ++resourceOrdinal),
      markdownPath,
      resourceRoot: input.sourceRoot,
    });
    if (resourceResolution.diagnostics.length > 0) {
      throw new Error("VERSION_RESOURCE_CLOSURE_FAILED");
    }

    await atomicWriteFile(resolve(versionDirectory, "book.yaml"), configYaml, {
      mode: 0o400,
    });
    const sourceFiles = await copyTree({
      destination: resolve(versionDirectory, "source"),
      source: input.sourceRoot,
    });
    const originalFiles = source.original_files as readonly Readonly<
      Record<string, unknown>
    >[];
    for (const original of originalFiles) {
      const originalPath = await resolveContainedPath(
        input.draftRoot,
        String(original.path),
      );
      const metadata = await lstat(originalPath);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new Error("VERSION_ORIGINAL_NOT_REGULAR");
      }
      const destination = resolve(
        versionDirectory,
        "originals",
        String(original.id),
      );
      await mkdir(dirname(destination), { mode: 0o700, recursive: true });
      await copyFile(originalPath, destination);
      await chmod(destination, 0o400);
      const copied = await digestFile(destination);
      if (copied.size !== original.size || copied.sha256 !== original.sha256) {
        throw new Error("VERSION_ORIGINAL_HASH_MISMATCH");
      }
    }

    const manifestResources: ManifestResource[] = [];
    for (const resource of resourceResolution.resources) {
      const bytes = await readFile(resource.absolutePath);
      const inspection = await inspectRasterImage({
        bytes,
        filename: resource.relativePath,
      });
      const outputPath = `published/assets/${resource.id}`;
      await atomicWriteFile(resolve(versionDirectory, outputPath), bytes, {
        mode: 0o400,
      });
      manifestResources.push(
        Object.freeze({
          ...resource,
          height: inspection.height,
          mediaType: mediaType(inspection.format),
          outputPath,
          sha256: sha256(bytes),
          size: bytes.byteLength,
          width: inspection.width,
        }),
      );
    }

    const pageByHeading = new Map(
      pages.flatMap((page) =>
        page.document.headings
          .filter((heading) => page.blockIds.includes(heading.blockId))
          .map((heading) => [heading.blockId, page.pageId] as const),
      ),
    );
    const renderedPages = await Promise.all(
      pages.map(async (page) => {
        const rendered = await renderSemanticDocument({
          document: page.document,
          headingHref(blockId) {
            const pageId = pageByHeading.get(blockId);
            if (!pageId) throw new Error("VERSION_HEADING_PAGE_MISSING");
            return `/books/${input.bookId}/pages/${pageId}#${blockId}`;
          },
          headingOverrides: page.headingOverrides,
          publishedResourceUrl: (resourceId) =>
            `/books/${input.bookId}/versions/${input.versionId}/resources/${resourceId}`,
          resourceResolution,
        });
        if (rendered.diagnostics.length > 0) {
          throw new Error("VERSION_RENDER_DIAGNOSTIC");
        }
        return { page, rendered };
      }),
    );
    const css = renderedPages
      .map(({ rendered }) => rendered.css)
      .filter(Boolean)
      .sort()
      .filter((value, index, values) => value !== values[index - 1])
      .join("");
    const cssPath = "published/styles/document.css";
    await atomicWriteFile(resolve(versionDirectory, cssPath), css, {
      mode: 0o400,
    });
    const language =
      typeof (config.metadata as Record<string, unknown> | undefined)
        ?.language === "string"
        ? String(
            (config.metadata as Record<string, unknown> | undefined)?.language,
          )
        : "zh-CN";
    for (const { page, rendered } of renderedPages) {
      await atomicWriteFile(
        resolve(versionDirectory, page.outputPath),
        htmlDocument({
          body: rendered.html,
          cssPath: `/books/${input.bookId}/versions/${input.versionId}/styles/document.css`,
          language,
          title: page.title,
        }),
        { mode: 0o400 },
      );
    }

    const createdAt = toIsoDateTime(input.createdAtMs);
    const manifest = buildDocumentManifest({
      bookId: input.bookId,
      configRevision: input.configRevision,
      createdAt,
      document,
      headings,
      mainMarkdownOutputPath: `source/${mainMarkdownRelativePath}`,
      pages,
      resourceReferences: resourceResolution.references,
      resources: manifestResources,
      sourceFiles,
      versionId: input.versionId,
    });
    validateDocumentManifest(manifest);
    const manifestJson = canonicalJson(manifest);
    await atomicWriteFile(
      resolve(versionDirectory, "document-manifest.json"),
      manifestJson,
      { mode: 0o400 },
    );

    const files = await describeFiles(versionDirectory);
    const marker = {
      book_id: input.bookId,
      book_yaml_sha256: sha256(configYaml),
      complete: true,
      compiler: compilerIdentity,
      config_revision: input.configRevision,
      created_at: createdAt,
      files: files.map(({ path, sha256: hash, size }) => ({
        path,
        sha256: hash,
        size,
      })),
      manifest_sha256: sha256(manifestJson),
      predecessor_version_id: input.predecessorVersionId,
      schema_version: 1,
      source_id: input.sourceId,
      version_id: input.versionId,
    };
    validateVersionMarker(marker);
    await atomicWriteFile(
      resolve(versionDirectory, "version.json"),
      canonicalJson(marker),
      { mode: 0o400 },
    );
    const artifact: VersionBuildArtifact = Object.freeze({
      bookId: input.bookId,
      configRevision: input.configRevision,
      manifestSha256: sha256(manifestJson),
      versionDirectory: "version",
      versionId: input.versionId,
    });
    await atomicWriteFile(
      resolve(stagingDirectory, versionBuildArtifactFilename),
      canonicalJson(artifact),
      { mode: 0o400 },
    );
    return artifact;
  } catch (error) {
    await rm(stagingDirectory, { force: true, recursive: true });
    throw error;
  }
}

export async function readVersionBuildArtifact(
  stagingDirectory: string,
): Promise<VersionBuildArtifact> {
  const bytes = await readFile(
    resolve(stagingDirectory, versionBuildArtifactFilename),
  );
  if (bytes.byteLength > 64 * 1024) {
    throw new Error("VERSION_BUILD_ARTIFACT_INVALID");
  }
  const parsed: unknown = JSON.parse(bytes.toString("utf8"));
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as Record<string, unknown>).versionDirectory !== "version"
  ) {
    throw new Error("VERSION_BUILD_ARTIFACT_INVALID");
  }
  return parsed as VersionBuildArtifact;
}
