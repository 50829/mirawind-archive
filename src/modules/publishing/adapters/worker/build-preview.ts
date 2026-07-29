import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { prepareConfiguredDocument } from "@/modules/publishing/core/publication/configured-document";
import { canonicalJson } from "@/modules/publishing/core/publication/manifest";
import type {
  ConfirmedSourceRegion,
  TypographyProvenance,
} from "@/modules/publishing/core/preparation/document-model";
import { inspectRasterImage } from "@/modules/publishing/core/publication/inspect-image";
import { resolveDocumentResources } from "@/modules/publishing/adapters/filesystem/resolve-document-resources";
import {
  type PreviewBuildArtifact,
  previewBuildArtifactFilename,
  previewBuildVersion,
} from "@/modules/publishing/adapters/worker/preview-artifact";
import {
  printedContentsDiagnostics,
  readPinnedAnalysis,
} from "@/modules/publishing/adapters/worker/preview-diagnostics";
import { renderPreviewPages } from "@/modules/publishing/adapters/worker/preview-pages";
import { parseBookConfigYaml } from "@/modules/publishing/core/publication/book-config-schema";
import {
  atomicWriteFile,
  resolveContainedPath,
} from "@/platform/filesystem/layout";
import {
  profilePipelineStage,
  recordPipelineProfileMetrics,
} from "@/observability/pipeline-profile";

export async function buildPreview(input: {
  readonly analysisPath: string;
  readonly bookId: number;
  readonly configRevision: number;
  readonly configYamlPath: string;
  readonly sourceRoot: string;
  readonly sourceId: string;
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
    const { analysis, config, configYaml, markdownBytes, markdownPath } =
      await profilePipelineStage("input_validation", async () => {
        const yaml = await readFile(input.configYamlPath, "utf8");
        const parsedConfig = parseBookConfigYaml(yaml);
        if (
          parsedConfig.book_id !== input.bookId ||
          parsedConfig.revision !== input.configRevision
        ) {
          throw new Error("PREVIEW_CONFIG_CAPTURE_MISMATCH");
        }
        const source = parsedConfig.source as Readonly<Record<string, unknown>>;
        const mainMarkdown = String(source.main_markdown);
        const resolvedMarkdownPath = await resolveContainedPath(
          input.sourceRoot,
          mainMarkdown,
        );
        const bytes = await readFile(resolvedMarkdownPath);
        const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
        if (sourceSha256 !== source.main_markdown_sha256) {
          throw new Error("PREVIEW_SOURCE_HASH_MISMATCH");
        }
        const pinnedAnalysis = await readPinnedAnalysis({
          analysisPath: input.analysisPath,
          configRevision: input.configRevision,
          sourceId: input.sourceId,
          sourceSha256,
        });
        return {
          analysis: pinnedAnalysis,
          config: parsedConfig,
          configYaml: yaml,
          markdownBytes: bytes,
          markdownPath: resolvedMarkdownPath,
        };
      });
    recordPipelineProfileMetrics({ markdown_bytes: markdownBytes.byteLength });
    const preparationDiagnostics = printedContentsDiagnostics(analysis);
    const configured = await profilePipelineStage("configured_document", () =>
      prepareConfiguredDocument({
        config,
        configSha256: createHash("sha256").update(configYaml).digest("hex"),
        markdownBytes,
      }),
    );
    recordPipelineProfileMetrics({
      headings: configured.headings.length,
      pages: configured.pages.length,
      root_blocks: configured.document.blocks.length,
    });
    const resolution = await profilePipelineStage("resource_resolution", () =>
      resolveDocumentResources({
        document: configured.document,
        markdownPath,
        resourceRoot: input.sourceRoot,
      }),
    );
    const assetsDirectory = resolve(previewDirectory, "assets");
    await mkdir(assetsDirectory, { mode: 0o700 });
    let resourceBytes = 0;
    await profilePipelineStage("asset_copy", async () => {
      for (const resource of resolution.resources) {
        const bytes = await readFile(resource.absolutePath);
        resourceBytes += bytes.byteLength;
        await inspectRasterImage({
          bytes,
          filename: resource.relativePath,
        });
        await atomicWriteFile(resolve(assetsDirectory, resource.id), bytes, {
          mode: 0o600,
        });
      }
    });
    recordPipelineProfileMetrics({
      resource_bytes: resourceBytes,
      resources: resolution.resources.length,
    });
    const { diagnostics, pageByHeading } = await renderPreviewPages({
      bookId: input.bookId,
      config,
      configRevision: input.configRevision,
      configured,
      preparationDiagnostics,
      previewDirectory,
      resolution,
    });
    return await profilePipelineStage("model_diagnostics", async () => {
      const boundedDiagnostics = [
        ...new Map(
          diagnostics
            .slice(0, 10_000)
            .map(
              (diagnostic) => [JSON.stringify(diagnostic), diagnostic] as const,
            ),
        ).values(),
      ];
      const sourceRegions = (
        config.source_regions as readonly ConfirmedSourceRegion[]
      ).map((region) => {
        const blockId = region.entries.find(
          (entry) => entry.body_heading_block_id,
        )?.body_heading_block_id;
        return {
          applied: region.applied,
          ...(blockId ? { block_id: blockId } : {}),
          confidence: "high",
          conflict_count: 0,
          end_byte: region.range.end_byte,
          entry_count: region.entries.length,
          kind: region.kind,
          matched_heading_count: region.entries.filter(
            (entry) => entry.body_heading_block_id,
          ).length,
          region_id: region.region_id,
          start_byte: region.range.start_byte,
        };
      });
      const typography = (
        (config.source as Readonly<Record<string, unknown>>)
          .preprocessing as Readonly<Record<string, unknown>>
      ).typography as TypographyProvenance;
      const model = Object.freeze({
        compiler_version: configured.identity.compiler_version,
        config_sha256: configured.identity.config_sha256,
        config_revision: input.configRevision,
        headings: configured.headings.map((heading) => ({
          block_id: heading.block_id,
          display_level: heading.display_level,
          include_in_toc: heading.include_in_toc,
          number: heading.number,
          page_id: pageByHeading.get(heading.block_id) ?? null,
          role: heading.role,
          source_level: heading.source_level,
          source_title: heading.source_title,
          starts_page: heading.starts_page,
          title: heading.display_title,
        })),
        pages: configured.pages.map((page) => ({
          page_id: page.pageId,
          title: page.title,
        })),
        renderer_version: configured.identity.renderer_version,
        semantic_digest: configured.identity.semantic_digest,
        source_regions: sourceRegions,
        source_sha256: configured.identity.source_sha256,
        typography,
        version: previewBuildVersion,
      });
      const diagnosticsPath = resolve(previewDirectory, "diagnostics.json");
      await atomicWriteFile(
        diagnosticsPath,
        canonicalJson({ diagnostics: boundedDiagnostics }),
        { mode: 0o600 },
      );
      await atomicWriteFile(
        resolve(previewDirectory, "preview-model.json"),
        canonicalJson(model),
        { mode: 0o600 },
      );
      const artifact: PreviewBuildArtifact = Object.freeze({
        diagnosticsRelativePath: "diagnostics.json",
        identity: configured.identity,
        previewRelativePath: "preview",
        version: previewBuildVersion,
      });
      await atomicWriteFile(
        resolve(stagingDirectory, previewBuildArtifactFilename),
        canonicalJson(artifact),
        { mode: 0o600 },
      );
      return artifact;
    });
  } catch (error) {
    await rm(stagingDirectory, { force: true, recursive: true });
    throw error;
  }
}
