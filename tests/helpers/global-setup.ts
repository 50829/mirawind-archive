import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { stringify } from "yaml";

import { createStrongEtag } from "@/http/cache/policies";
import { SqliteBookAccessRepository } from "@/modules/catalog/adapters/sqlite/book-access";
import { setBookAccess } from "@/modules/catalog/application/commands/set-book-access";
import { createSetupAuth } from "@/modules/identity/adapters/better-auth/setup-auth";
import { bootstrapAdministrator } from "@/composition/cli";
import { openDatabase } from "@/platform/sqlite/connection";
import { applyMigrations } from "@/platform/sqlite/migrate";
import { loadMigrationManifest } from "@/platform/sqlite/migration-manifest";
import { DraftRepository } from "@/modules/publishing/adapters/sqlite/drafts";
import { ImportRepository } from "@/modules/publishing/adapters/sqlite/imports";
import { JobRepository } from "@/modules/publishing/adapters/sqlite/jobs";
import { DraftCandidateRepository } from "@/modules/publishing/adapters/sqlite/draft-candidate-repository";
import { CandidateRegistrationAdapter } from "@/modules/publishing/adapters/sqlite/candidate-registration";
import { CandidatePublicationRepository } from "@/modules/publishing/adapters/sqlite/candidate-publication";
import { BookPresentationRepository } from "@/modules/catalog/adapters/sqlite/book-presentations";
import { buildCandidateVersion } from "@/modules/publishing/adapters/filesystem/build-candidate-version";
import {
  finalizeCandidate,
  m1PublishPolicy,
  publishCandidate,
} from "@/modules/publishing/application/publishing-api";
import { SourceRepository } from "@/modules/publishing/adapters/sqlite/sources";
import { createStorageLayout } from "@/platform/filesystem/storage-layout";
import { normalizeDocumentBlocks } from "@/modules/publishing/core/preparation/normalize-document";
import { parseMarkdownDocument } from "@/modules/publishing/core/preparation/parse-markdown";

import { buildZip } from "../../scripts/fixtures/zip-builder.js";
import { createBookConfigV4, structureForDocument } from "./book-config.js";
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
  const nowMs = Date.now();
  const drafts = new DraftRepository(input.database);
  const book = drafts.createBook({ nowMs, title: "E2E Library Book" });
  const imported = new ImportRepository(input.database).createUploaded({
    bookId: book.id,
    expiresAtMs: nowMs + 86_400_000,
    id: "imp_e2e_library_seed_000001",
    nowMs: nowMs + 1,
    originalName: "fixture.zip",
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
    "- A visible list item",
    "- Another list item",
    "",
    "```text",
    "const readerFixture = true;",
    "```",
    "",
    "```mermaid",
    "flowchart LR",
    "  Source --> Reader",
    "```",
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
    origin: "import",
    sourceRootRelativePath: `books/${book.id}/draft/sources/${sourceId}`,
  });
  const headingIds = [
    "blk_e2e_library_opening_0001",
    "blk_e2e_library_overview_0001",
    "blk_e2e_library_continue_0001",
  ] as const;
  let headingOrdinal = 0;
  let contentOrdinal = 0;
  const document = normalizeDocumentBlocks(parseMarkdownDocument(markdown), {
    idFactory: (node) =>
      node.type === "heading"
        ? (headingIds[headingOrdinal++] ?? "blk_e2e_library_heading_overflow")
        : `blk_e2e_library_content_${String(++contentOrdinal).padStart(6, "0")}`,
  });
  const structure = structureForDocument(document).map((node, index) => ({
    ...node,
    starts_page: index === 0 || index === 2,
  }));
  const title = "E2E Library Book";
  const config = createBookConfigV4({
    alias: "e2e-library-book",
    bookId: book.id,
    document,
    metadata: {
      authors: ["Mirawind Test"],
      description: "A stable browser fixture for the public reading loop.",
      language: "en",
    },
    numbering: "generated",
    sourceSha256: markdownSha256,
    structure,
    title,
  });
  const configYaml = stringify(config, { lineWidth: 0 });
  const configSha256 = createHash("sha256").update(configYaml).digest("hex");
  const configPath = resolve(draftRoot, "configs", "1", "book.yaml");
  await mkdir(dirname(configPath), { mode: 0o700, recursive: true });
  await writeFile(configPath, configYaml, { mode: 0o400 });
  drafts.addConfigRevision({
    bookId: book.id,
    nowMs: nowMs + 3,
    revision: 1,
    schemaVersion: 4,
    sourceId,
    title,
    yamlRelativePath: `books/${book.id}/draft/configs/1/book.yaml`,
    yamlSha256: configSha256,
  });
  const candidates = new DraftCandidateRepository(input.database);
  const candidate = candidates.createForCurrentRevision({
    bookId: book.id,
    configRevision: 1,
    nowMs: nowMs + 4,
    sourceId,
  });
  const jobs = new JobRepository(input.database);
  jobs.claimNext({ leaseOwner: "e2e-seed", nowMs: nowMs + 5 });
  const command = candidates.buildCommand(candidate.attemptId);
  const artifact = await buildCandidateVersion({
    command,
    createdAtMs: nowMs + 6,
    layout: input.layout,
    preparationDiagnostics: [],
  });
  await finalizeCandidate({
    artifact,
    command,
    leaseOwner: "e2e-seed",
    nowMs: nowMs + 7,
    registration: new CandidateRegistrationAdapter(
      input.database,
      input.layout,
      new BookPresentationRepository(input.database),
    ),
  });
  await publishCandidate({
    actorUserId: null,
    bookId: book.id,
    expectedConfigEtag: createStrongEtag(configSha256),
    nowMs: nowMs + 8,
    policy: m1PublishPolicy,
    publication: new CandidatePublicationRepository(input.database),
  });
  setBookAccess({
    access: "public",
    actorUserId: null,
    bookId: book.id,
    books: new SqliteBookAccessRepository(input.database),
    nowMs: nowMs + 9,
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

async function prepareE2eData(): Promise<void> {
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
}

export default async function globalSetup(): Promise<() => Promise<void>> {
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
} else if (process.env.MIRAWIND_E2E_PREPARE_ONLY === "1") {
  await prepareE2eData();
}
