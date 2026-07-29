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

import { compileBook } from "@/modules/publishing/core/publication/compile-book";
import {
  buildDocumentManifest,
  canonicalJson,
  compilerIdentity,
  type ManifestResource,
  type ManifestSourceFile,
} from "@/modules/publishing/core/publication/manifest";
import { inspectRasterImage } from "@/modules/publishing/core/publication/inspect-image";
import { resolveDocumentResources } from "@/modules/publishing/adapters/filesystem/resolve-document-resources";
import {
  buildSearchSpool,
  writeSearchSpool,
} from "@/modules/publishing/adapters/filesystem/search-spool";
import { materializeVersionPages } from "@/modules/publishing/adapters/reader-html/materialize-version-pages";
import { toIsoDateTime } from "@/domain/time";
import type { SemanticCompilationIdentity } from "@/modules/publishing/core/preparation/document-model";
import { parseBookConfigYaml } from "@/modules/publishing/core/publication/book-config-schema";
import {
  validateDocumentManifest,
  validateVersionMarker,
} from "@/modules/publishing/core/publication/document-manifest-schema";
import {
  atomicWriteFile,
  resolveContainedPath,
} from "@/platform/filesystem/layout";
import {
  profilePipelineStage,
  recordPipelineProfileMetrics,
} from "@/observability/pipeline-profile";

export const versionBuildArtifactFilename = "version-build-result.json";

export interface VersionBuildArtifact {
  readonly bookId: number;
  readonly configRevision: number;
  readonly identity: SemanticCompilationIdentity;
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
  prefix: "res",
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
    const {
      config,
      configYaml,
      mainMarkdownRelativePath,
      markdownBytes,
      markdownPath,
      source,
    } = await profilePipelineStage("input_validation", async () => {
      const yaml = await readFile(input.configYamlPath, "utf8");
      const parsedConfig = parseBookConfigYaml(yaml);
      if (
        parsedConfig.book_id !== input.bookId ||
        parsedConfig.revision !== input.configRevision
      ) {
        throw new Error("VERSION_CONFIG_CAPTURE_MISMATCH");
      }
      const parsedSource = parsedConfig.source as Readonly<
        Record<string, unknown>
      >;
      const mainMarkdown = String(parsedSource.main_markdown);
      const resolvedMarkdownPath = await resolveContainedPath(
        input.sourceRoot,
        mainMarkdown,
      );
      const bytes = await readFile(resolvedMarkdownPath);
      if (sha256(bytes) !== parsedSource.main_markdown_sha256) {
        throw new Error("VERSION_SOURCE_HASH_MISMATCH");
      }
      return {
        config: parsedConfig,
        configYaml: yaml,
        mainMarkdownRelativePath: mainMarkdown,
        markdownBytes: bytes,
        markdownPath: resolvedMarkdownPath,
        source: parsedSource,
      };
    });
    recordPipelineProfileMetrics({ markdown_bytes: markdownBytes.byteLength });
    const configured = await profilePipelineStage("configured_document", () =>
      compileBook({
        config,
        configSha256: sha256(configYaml),
        markdownBytes,
      }),
    );
    const { document, headings, pages } = configured;
    recordPipelineProfileMetrics({
      headings: headings.length,
      pages: pages.length,
      root_blocks: document.blocks.length,
    });

    let resourceOrdinal = 0;
    const resourceResolution = await profilePipelineStage(
      "resource_resolution",
      () =>
        resolveDocumentResources({
          document,
          idFactory: () =>
            opaqueBuildId("res", input.versionId, ++resourceOrdinal),
          markdownPath,
          resourceRoot: input.sourceRoot,
        }),
    );
    if (resourceResolution.diagnostics.length > 0) {
      throw new Error("VERSION_RESOURCE_CLOSURE_FAILED");
    }

    const sourceFiles = await profilePipelineStage("source_copy", async () => {
      await atomicWriteFile(
        resolve(versionDirectory, "book.yaml"),
        configYaml,
        { mode: 0o400 },
      );
      return copyTree({
        destination: resolve(versionDirectory, "source"),
        source: input.sourceRoot,
      });
    });
    const originalFiles = source.original_files as readonly Readonly<
      Record<string, unknown>
    >[];
    await profilePipelineStage("original_copy", async () => {
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
        if (
          copied.size !== original.size ||
          copied.sha256 !== original.sha256
        ) {
          throw new Error("VERSION_ORIGINAL_HASH_MISMATCH");
        }
      }
    });

    const manifestResources: ManifestResource[] = [];
    let resourceBytes = 0;
    await profilePipelineStage("asset_copy", async () => {
      for (const resource of resourceResolution.resources) {
        const bytes = await readFile(resource.absolutePath);
        resourceBytes += bytes.byteLength;
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
    });
    recordPipelineProfileMetrics({
      resource_bytes: resourceBytes,
      resources: resourceResolution.resources.length,
    });

    await materializeVersionPages({
      bookId: input.bookId,
      compiled: configured,
      config,
      originalFiles,
      resourceResolution,
      versionDirectory,
      versionId: input.versionId,
    });

    const createdAt = toIsoDateTime(input.createdAtMs);
    const manifestJson = await profilePipelineStage(
      "manifest_build",
      async () => {
        const manifest = buildDocumentManifest({
          book: configured,
          bookId: input.bookId,
          configRevision: input.configRevision,
          createdAt,
          mainMarkdownOutputPath: `source/${mainMarkdownRelativePath}`,
          resourceReferences: resourceResolution.references,
          resources: manifestResources,
          sourceFiles,
          versionId: input.versionId,
        });
        validateDocumentManifest(manifest);
        const json = canonicalJson(manifest);
        await atomicWriteFile(
          resolve(versionDirectory, "document-manifest.json"),
          json,
          { mode: 0o400 },
        );
        return json;
      },
    );
    const metadata = config.metadata as
      Readonly<Record<string, unknown>> | undefined;
    const authors = Array.isArray(metadata?.authors)
      ? metadata.authors.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    const searchSpool = await profilePipelineStage("search_build", async () => {
      const spool = buildSearchSpool({
        authors,
        book: configured,
        bookId: input.bookId,
        title: String(config.title),
        versionId: input.versionId,
      });
      await writeSearchSpool(
        resolve(versionDirectory, "derived", "search-spool.json"),
        spool,
      );
      return spool;
    });
    recordPipelineProfileMetrics({
      search_fts_rows: searchSpool.ftsRows.length,
      search_short_rows: searchSpool.shortRows.length,
    });

    const files = await profilePipelineStage("file_inventory_hash", () =>
      describeFiles(versionDirectory),
    );
    return await profilePipelineStage("version_marker", async () => {
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
        schema_version: 2,
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
        identity: configured.identity,
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
    });
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
