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

import { compileBook } from "../../core/publication/compile-book";
import {
  buildDocumentManifest,
  canonicalJson,
  compilerIdentity,
  type ManifestResource,
  type ManifestSourceFile,
} from "../../core/publication/manifest";
import { inspectRasterImage } from "../../core/publication/inspect-image";
import { resolveDocumentResources } from "./resolve-document-resources";
import type { CompiledBook } from "../../core/publication/compiled-book";
import { toIsoDateTime } from "@/domain/time";
import type { SemanticCompilationIdentity } from "../../core/preparation/document-model";
import { parseBookConfigYaml } from "../../core/publication/book-config-schema";
import { validateVersionMarker } from "../../core/publication/document-manifest-schema";
import { resolveContainedPath } from "@/platform/filesystem/contained-path";
import {
  createCandidateFileInventory,
  type CandidateFileInventory,
} from "./candidate-file-inventory";
import {
  profilePipelineStage,
  recordPipelineProfileMetrics,
} from "@/observability/pipeline-profile";

export interface CandidateAssemblyArtifact {
  readonly bookId: number;
  readonly configRevision: number;
  readonly identity: SemanticCompilationIdentity;
  readonly manifestSha256: string;
  readonly versionDirectory: "version";
  readonly versionId: string;
}

export interface CandidateAssemblyResult extends CandidateAssemblyArtifact {
  readonly pageMaterialization: unknown;
}

export interface CandidatePageMaterializationContext {
  readonly bookId: number;
  readonly candidateDirectory: string;
  readonly compiled: CompiledBook;
  readonly config: Readonly<Record<string, unknown>>;
  readonly configRevision: number;
  readonly files: CandidateFileInventory;
  readonly originalFiles: readonly Readonly<Record<string, unknown>>[];
  readonly resourceResolution: Awaited<
    ReturnType<typeof resolveDocumentResources>
  >;
  readonly versionId: string;
}

export interface AssembleCandidateInput {
  readonly bookId: number;
  readonly configRevision: number;
  readonly configYamlPath: string;
  readonly createdAtMs: number;
  readonly draftRoot: string;
  readonly materializePages: (
    input: CandidatePageMaterializationContext,
  ) => Promise<unknown>;
  readonly predecessorVersionId: string | null;
  readonly signal?: AbortSignal;
  readonly sourceId: string;
  readonly sourceRoot: string;
  readonly stagingDirectory: string;
  readonly versionId: string;
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
  readonly signal?: AbortSignal;
  readonly source: string;
}): Promise<readonly ManifestSourceFile[]> {
  const files = await filesUnder(input.source);
  const descriptors: ManifestSourceFile[] = [];
  for (const sourcePath of files) {
    input.signal?.throwIfAborted();
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

export async function assembleCandidate(
  input: AssembleCandidateInput,
): Promise<CandidateAssemblyResult> {
  const stagingDirectory = resolve(input.stagingDirectory);
  const versionDirectory = resolve(stagingDirectory, "version");
  const files = createCandidateFileInventory(versionDirectory);
  try {
    input.signal?.throwIfAborted();
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
    input.signal?.throwIfAborted();
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
          additionalImagePaths:
            typeof (config.metadata as Readonly<Record<string, unknown>>)
              .cover_path === "string"
              ? [
                  String(
                    (config.metadata as Readonly<Record<string, unknown>>)
                      .cover_path,
                  ),
                ]
              : [],
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
      input.signal?.throwIfAborted();
      await files.write("book.yaml", configYaml);
      const copied = await copyTree({
        destination: resolve(versionDirectory, "source"),
        ...(input.signal ? { signal: input.signal } : {}),
        source: input.sourceRoot,
      });
      for (const file of copied) files.record(file);
      return copied;
    });
    const originalFiles = source.original_files as readonly Readonly<
      Record<string, unknown>
    >[];
    await profilePipelineStage("original_copy", async () => {
      for (const original of originalFiles) {
        input.signal?.throwIfAborted();
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
        files.record({
          path: `originals/${String(original.id)}`,
          sha256: String(original.sha256),
          size: Number(original.size),
        });
      }
    });

    const manifestResources: ManifestResource[] = [];
    let resourceBytes = 0;
    await profilePipelineStage("asset_copy", async () => {
      for (const resource of resourceResolution.resources) {
        input.signal?.throwIfAborted();
        const bytes = await readFile(resource.absolutePath);
        resourceBytes += bytes.byteLength;
        const inspection = await inspectRasterImage({
          bytes,
          filename: resource.relativePath,
        });
        const outputPath = `published/assets/${resource.id}`;
        await files.write(outputPath, bytes);
        const resourceSha256 = sha256(bytes);
        manifestResources.push(
          Object.freeze({
            ...resource,
            height: inspection.height,
            mediaType: mediaType(inspection.format),
            outputPath,
            sha256: resourceSha256,
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

    const pageMaterialization = await profilePipelineStage(
      "candidate_materialization",
      () =>
        input.materializePages({
          bookId: input.bookId,
          candidateDirectory: versionDirectory,
          compiled: configured,
          config,
          configRevision: input.configRevision,
          files,
          originalFiles,
          resourceResolution,
          versionId: input.versionId,
        }),
    );
    input.signal?.throwIfAborted();

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
        const json = canonicalJson(manifest);
        await files.write("document-manifest.json", json);
        return json;
      },
    );
    const inventory = await profilePipelineStage("file_inventory", () =>
      files.snapshot(),
    );
    return await profilePipelineStage("version_marker", async () => {
      const marker = {
        book_id: input.bookId,
        book_yaml_sha256: sha256(configYaml),
        complete: true,
        compiler: compilerIdentity,
        config_revision: input.configRevision,
        created_at: createdAt,
        files: inventory.map(({ path, sha256: hash, size }) => ({
          path,
          sha256: hash,
          size,
        })),
        manifest_sha256: sha256(manifestJson),
        predecessor_version_id: input.predecessorVersionId,
        schema_version: 3,
        source_id: input.sourceId,
        version_id: input.versionId,
      };
      validateVersionMarker(marker);
      await files.writeVersionMarker(canonicalJson(marker));
      const artifact: CandidateAssemblyArtifact = Object.freeze({
        bookId: input.bookId,
        configRevision: input.configRevision,
        identity: configured.identity,
        manifestSha256: sha256(manifestJson),
        versionDirectory: "version",
        versionId: input.versionId,
      });
      return Object.freeze({
        ...artifact,
        pageMaterialization,
      });
    });
  } catch (error) {
    await rm(stagingDirectory, { force: true, recursive: true });
    throw error;
  }
}
