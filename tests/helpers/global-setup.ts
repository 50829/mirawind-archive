import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { stringify } from "yaml";

import { createSetupAuth } from "@/auth/setup-server";
import { bootstrapAdministrator } from "@/cli/commands/admin-bootstrap";
import { openDatabase } from "@/db/connection";
import { applyMigrations } from "@/db/migrate";
import { loadMigrationManifest } from "@/db/migration-manifest";
import { DraftRepository } from "@/db/repositories/drafts";
import { ImportRepository } from "@/db/repositories/imports";
import { JobRepository } from "@/db/repositories/jobs";
import { SourceRepository } from "@/db/repositories/sources";
import { createStorageLayout } from "@/storage/layout";

import { buildZip } from "../../scripts/fixtures/zip-builder.js";
import { startWorkerProcess } from "./processes.js";

export const e2eAdministrator = Object.freeze({
  email: "admin@example.test",
  password: "e2e-only-password-0123456789",
});
export const e2eDataRoot = resolve(".cache/e2e-playwright-data");
export const e2eFixtureRoot = resolve(".cache/e2e-fixtures");
export const e2eOrigin = `http://127.0.0.1:${process.env.MIRAWIND_E2E_PORT ?? "4321"}`;
export const e2eHighMarkdown = [
  "# E2E Cloud Book",
  "",
  "A durable source paragraph.",
  "",
  "## First chapter",
  "",
  "The preview is compiled in the worker.",
].join("\n");
const e2ePrintedTocMarkdown = [
  "# 目录",
  "",
  "# 第 1 章 绪论 ...... 1",
  "",
  "1.1 中文与 English 排版 ...... 3",
  "",
  "1.2 模型评估 ...... 8",
  "",
  "# 第 2 章 方法 ...... 15",
  "",
  "2.1 训练 ...... 17",
  "",
  "2.2 测试 ...... 23",
  "",
  "# 第 1 章 绪论",
  "",
  "## 1.1 中文与 English 排版",
  "",
  "正文。",
  "",
  "## 1.2 模型评估",
  "",
  "正文。",
  "",
  "# 第 2 章 方法",
  "",
  "## 2.1 训练",
  "",
  "正文。",
  "",
  "## 2.2 测试",
  "",
  "正文。",
].join("\n");
const e2ePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const execFileAsync = promisify(execFile);

async function seedPublishedLibraryBook(input: {
  readonly database: ReturnType<typeof openDatabase>;
  readonly layout: Awaited<ReturnType<typeof createStorageLayout>>;
}): Promise<void> {
  const { buildPublish, finalizeBuiltPublication } =
    await import("@/jobs/handlers/build-publish");
  const nowMs = Date.now();
  const drafts = new DraftRepository(input.database);
  const book = drafts.createBook({ nowMs, title: "E2E Library Book" });
  const imported = new ImportRepository(input.database).createUploaded({
    bookId: book.id,
    expiresAtMs: nowMs + 86_400_000,
    id: "imp_e2e_library_seed_000001",
    nowMs: nowMs + 1,
    uploadRelativePath: "tmp/e2e-library-seed.zip",
    uploadSha256: "a".repeat(64),
    uploadSizeBytes: 1,
  });
  const sourceId = "src_e2e_library_seed_000001";
  const draftRoot = resolve(
    input.layout.bookDirectory,
    String(book.id),
    "draft",
  );
  const sourceRoot = resolve(draftRoot, "sources", sourceId);
  await mkdir(sourceRoot, { mode: 0o700, recursive: true });
  const markdown = [
    "# Opening",
    "",
    "A seeded public book for the complete library and reading journey.",
    "",
    ...Array.from(
      { length: 12 },
      (_, index) =>
        `Opening context paragraph ${index + 1} keeps the first page long enough to exercise local navigation.`,
    ).flatMap((paragraph) => [paragraph, ""]),
    "## Overview",
    "",
    "The local outline follows this section while the full contents remains hierarchical.",
    "",
    ...Array.from(
      { length: 8 },
      (_, index) =>
        `Overview detail paragraph ${index + 1} keeps the section readable during scroll tracking.`,
    ).flatMap((paragraph) => [paragraph, ""]),
    "## Continue",
    "",
    "Searchable reader content.",
  ].join("\n");
  await writeFile(resolve(sourceRoot, "book.md"), markdown, { mode: 0o400 });
  const markdownSha256 = createHash("sha256").update(markdown).digest("hex");
  new SourceRepository(input.database).createSnapshot({
    analysisVersion: "e2e-seed-v1",
    bookId: book.id,
    createdFromImportId: imported.id,
    id: sourceId,
    mainMarkdownPath: "book.md",
    mainMarkdownSha256: markdownSha256,
    nowMs: nowMs + 2,
    sourceRootRelativePath: `books/${book.id}/draft/sources/${sourceId}`,
  });
  const config = {
    alias: "e2e-library-book",
    book_id: book.id,
    metadata: {
      authors: ["Mirawind Test"],
      description: "A stable browser fixture for the public reading loop.",
      language: "en",
    },
    publishing: {
      code: { line_numbers: false },
      numbering: { mode: "normalized" },
    },
    revision: 1,
    schema_version: 3,
    source: {
      main_markdown: "book.md",
      main_markdown_sha256: markdownSha256,
      original_files: [],
      preprocessing: {
        typography: {
          input_sha256: markdownSha256,
          output_sha256: markdownSha256,
          profile: "verbatim-v1",
          protected_nodes: 0,
          punctuation_converted: 0,
          spaces_normalized: 0,
        },
      },
    },
    source_regions: [],
    structure: [
      {
        block_id: "blk_e2e_library_opening_0001",
        display_level: 1,
        include_in_toc: true,
        role: "body",
        starts_page: true,
      },
      {
        block_id: "blk_e2e_library_overview_0001",
        display_level: 2,
        include_in_toc: true,
        starts_page: false,
      },
      {
        block_id: "blk_e2e_library_continue_0001",
        display_level: 2,
        include_in_toc: true,
        starts_page: true,
      },
    ],
    title: "E2E Library Book",
  };
  const configYaml = stringify(config, { lineWidth: 0 });
  const configPath = resolve(draftRoot, "configs", "1", "book.yaml");
  await mkdir(dirname(configPath), { mode: 0o700, recursive: true });
  await writeFile(configPath, configYaml, { mode: 0o400 });
  drafts.addConfigRevision({
    alias: config.alias,
    bookId: book.id,
    nowMs: nowMs + 3,
    revision: 1,
    schemaVersion: 3,
    sourceId,
    title: config.title,
    yamlRelativePath: `books/${book.id}/draft/configs/1/book.yaml`,
    yamlSha256: createHash("sha256").update(configYaml).digest("hex"),
  });
  const jobs = new JobRepository(input.database);
  const preview = jobs.create({
    bookId: book.id,
    capturedConfigRevision: 1,
    capturedSourceId: sourceId,
    kind: "build_preview",
    nowMs: nowMs + 4,
  });
  drafts.createPreview({
    bookId: book.id,
    configRevision: 1,
    jobId: preview.id,
    sourceId,
  });
  jobs.claimNext({ leaseOwner: "e2e-seed", nowMs: nowMs + 5 });
  jobs.completeSuccess({
    jobId: preview.id,
    leaseOwner: "e2e-seed",
    nowMs: nowMs + 6,
  });
  drafts.completePreview({
    bookId: book.id,
    configRevision: 1,
    diagnosticsRelativePath: `books/${book.id}/draft/previews/1/diagnostics.json`,
    nowMs: nowMs + 7,
    previewRelativePath: `books/${book.id}/draft/previews/1`,
  });
  const publish = jobs.create({
    bookId: book.id,
    capturedConfigRevision: 1,
    capturedSourceId: sourceId,
    kind: "build_publish",
    nowMs: nowMs + 8,
  });
  jobs.claimNext({ leaseOwner: "e2e-seed", nowMs: nowMs + 9 });
  const stagingDirectory = resolve(input.layout.temporaryDirectory, publish.id);
  await buildPublish({
    bookId: book.id,
    configRevision: 1,
    configYamlPath: configPath,
    createdAtMs: nowMs + 10,
    draftRoot,
    jobId: publish.id,
    predecessorVersionId: null,
    sourceId,
    sourceRoot,
    stagingDirectory,
  });
  await finalizeBuiltPublication({
    actorUserId: null,
    database: input.database,
    jobId: publish.id,
    layout: input.layout,
    leaseOwner: "e2e-seed",
    nowMs: nowMs + 11,
    stagingDirectory,
  });
}

async function seedPublishedLibraryBookInIsolatedRuntime(): Promise<void> {
  await execFileAsync(
    resolve("node_modules/.bin/tsx"),
    [resolve("tests/helpers/global-setup.ts")],
    {
      env: {
        ...process.env,
        MIRAWIND_E2E_SEED_ONLY: "1",
      },
    },
  );
}

export async function ensureTestDataRoot(
  relativePath = "test-results/runtime-data",
): Promise<string> {
  const dataRoot = resolve(relativePath);
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  return dataRoot;
}

async function removeLockedE2eTree(path: string): Promise<void> {
  const expectedParent = resolve(".cache");
  if (dirname(path) !== expectedParent) {
    throw new Error("Refusing to clean a non-E2E data root");
  }
  const metadata = await lstat(path).catch(() => null);
  if (!metadata) return;
  const unlock = async (directory: string): Promise<void> => {
    await chmod(directory, 0o700);
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map((entry) => unlock(resolve(directory, entry.name))),
    );
  };
  if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
    await unlock(path);
  }
  await rm(path, { force: true, recursive: true });
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  await removeLockedE2eTree(e2eDataRoot);
  await removeLockedE2eTree(e2eFixtureRoot);
  const layout = await createStorageLayout(e2eDataRoot);
  await mkdir(e2eFixtureRoot, { mode: 0o700, recursive: true });
  const database = openDatabase(
    resolve(layout.databaseDirectory, "mirawind.sqlite"),
    { role: "worker" },
  );
  try {
    applyMigrations(database, await loadMigrationManifest());
    await bootstrapAdministrator({
      auth: createSetupAuth({
        database,
        environment: {
          allowedHosts: ["127.0.0.1", "localhost"],
          authSecret: "test-only-secret-0123456789-abcdef",
          dataDirectory: e2eDataRoot,
          passkeyRpId: "127.0.0.1",
          publicOrigin: e2eOrigin,
        },
      }),
      database,
      displayName: "Administrator",
      email: e2eAdministrator.email,
      nowMs: Date.now(),
      password: e2eAdministrator.password,
    });
  } finally {
    database.close();
  }
  await seedPublishedLibraryBookInIsolatedRuntime();

  await Promise.all([
    writeFile(
      resolve(e2eFixtureRoot, "high-confidence.zip"),
      buildZip({
        entries: [
          { data: e2eHighMarkdown, name: "wrapper/result/full.md" },
          { data: '{"pages":[]}', name: "wrapper/result/layout.json" },
        ],
      }),
    ),
    writeFile(
      resolve(e2eFixtureRoot, "generic.zip"),
      buildZip({
        entries: [
          {
            data: "# E2E Generic Book\n\nConfirm this candidate.",
            name: "notes.md",
          },
        ],
      }),
    ),
    writeFile(
      resolve(e2eFixtureRoot, "ambiguous.zip"),
      buildZip({
        entries: [
          { data: "# First Candidate\n\nFirst body.", name: "first.md" },
          { data: "# Second Candidate\n\nSecond body.", name: "second.md" },
        ],
      }),
    ),
    writeFile(
      resolve(e2eFixtureRoot, "publish.zip"),
      buildZip({
        entries: [
          {
            data: [
              "# Front",
              "",
              "Opening.",
              "",
              "# Main",
              "",
              "Published body.",
              "",
              "## Details",
              "",
              "Detail body.",
              "",
              '![Pixel](pixel.png "Pixel")',
              "",
              "### Semantics",
              "",
              "- First item",
              "- Second item",
              "",
              "| Name | Value |",
              "| --- | --- |",
              "| alpha | 1 |",
              "",
              "Formula $x+y$ and a footnote.[^reader]",
              "",
              "```ts",
              "const answer: number = 42",
              "```",
              "",
              "::: note",
              "Semantic note body.",
              ":::",
              "",
              "[^reader]: Footnote body.",
              "",
              "# Appendix",
              "",
              "Appendix body.",
              "",
              "# Back",
              "",
              "Closing.",
            ].join("\n"),
            name: "wrapper/result/full.md",
          },
          {
            data: e2ePixelPng,
            name: "wrapper/result/pixel.png",
          },
          { data: '{"pages":[]}', name: "wrapper/result/layout.json" },
        ],
      }),
    ),
    writeFile(
      resolve(e2eFixtureRoot, "publishing-quality.zip"),
      buildZip({
        entries: [
          {
            data: [
              "# 排版质量",
              "",
              "中文English123测试,继续:结束?",
              "",
              "URL https://example.com/a?x=1&y=2 和 `v1.2.3` 不改。",
              "",
              "公式 $x+y$ 保持。",
              "",
              "$$",
              "\\notacommand{",
              "$$",
            ].join("\n"),
            name: "wrapper/result/full.md",
          },
          { data: '{"pages":[]}', name: "wrapper/result/layout.json" },
        ],
      }),
    ),
    writeFile(
      resolve(e2eFixtureRoot, "printed-toc.zip"),
      buildZip({
        entries: [
          {
            data: e2ePrintedTocMarkdown,
            name: "wrapper/result/full.md",
          },
          { data: '{"pages":[]}', name: "wrapper/result/layout.json" },
        ],
      }),
    ),
  ]);

  const worker = await startWorkerProcess({
    dataRoot: e2eDataRoot,
    environment: {
      MIRAWIND_AUTH_SECRET: "test-only-secret-0123456789-abcdef",
    },
    publicOrigin: e2eOrigin,
  });
  return async () => worker.stop();
}

if (process.env.MIRAWIND_E2E_SEED_ONLY === "1") {
  const layout = await createStorageLayout(e2eDataRoot);
  const database = openDatabase(
    resolve(layout.databaseDirectory, "mirawind.sqlite"),
    { role: "worker" },
  );
  try {
    await seedPublishedLibraryBook({ database, layout });
  } finally {
    database.close();
  }
}
