import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

import { extractZipFile } from "../../src/modules/publishing/adapters/filesystem/extract-archive.js";
import {
  parseRealFixtureManifest,
  verifyRealMineruFixtures,
} from "./verify-real-mineru.js";

interface PdfRenderInput {
  readonly outputDirectory: string;
  readonly pageIndices: readonly number[];
  readonly pdfPath: string;
}

export interface ReferencePackInput {
  readonly archivePath: string;
  readonly fixtureId: string;
  readonly outputDirectory: string;
  readonly pageIndices?: readonly number[];
  readonly pdfInspector?: (path: string) => Promise<number>;
  readonly pdfRenderer?: (input: PdfRenderInput) => Promise<readonly string[]>;
  readonly signal?: AbortSignal;
  readonly temporaryParent?: string;
}

export interface ContentObservation {
  readonly page_index: number;
  readonly source_index: number;
  readonly type: string;
  readonly text: string;
}
export interface MineruReferencePack {
  readonly archive_sha256: string;
  readonly fixture_id: string;
  readonly content_json: {
    readonly relative_path: string;
    readonly input_sha256: string;
    readonly records: readonly ContentObservation[];
  };
  readonly pdf_documents: readonly {
    readonly page_count: number;
    readonly relative_path: string;
    readonly rendered_pages: readonly {
      readonly page_index: number;
      readonly relative_path: string;
      readonly sha256: string;
    }[];
    readonly sha256: string;
  }[];
  readonly schema_version: 2;
  readonly sidecars: readonly {
    readonly relative_path: string;
    readonly sha256: string;
    readonly size_bytes: number;
  }[];
}

const fixtureIdPattern = /^real-mineru-[a-z0-9]{6,32}$/u;
const maximumFiles = 20_000;
const maximumContentBytes = 256 * 1024 * 1024;

async function sha256File(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function regularFiles(root: string): Promise<readonly string[]> {
  const output: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) break;
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error("REFERENCE_PACK_LINK_REJECTED");
      }
      if (entry.isDirectory()) {
        pending.push(path);
      } else if (entry.isFile()) {
        output.push(path);
        if (output.length > maximumFiles) {
          throw new Error("REFERENCE_PACK_FILE_LIMIT");
        }
      } else {
        throw new Error("REFERENCE_PACK_SPECIAL_FILE_REJECTED");
      }
    }
  }
  return Object.freeze(
    output.sort((left, right) =>
      relative(root, left).localeCompare(relative(root, right), "en"),
    ),
  );
}

export function sourceContentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(sourceContentText).join("");
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  return sourceContentText(record.content);
}

export function observeContentRecords(
  value: unknown,
): readonly ContentObservation[] {
  if (!Array.isArray(value) || value.some((page) => !Array.isArray(page)))
    throw new Error("REFERENCE_PACK_CONTENT_INVALID");
  return value.flatMap((page: unknown[], page_index) =>
    page.map((item, source_index) => {
      if (!item || typeof item !== "object")
        throw new Error("REFERENCE_PACK_CONTENT_INVALID");
      const record = item as {
        type: string;
        content?: Record<string, unknown>;
      };
      const content = record.content ?? {};
      return {
        page_index,
        source_index,
        type: record.type,
        text: sourceContentText(
          content.title_content ??
            content.paragraph_content ??
            content.math_content ??
            content.code_content ??
            content.algorithm_content ??
            (Array.isArray(content.list_items)
              ? content.list_items
                  .map((item) => sourceContentText(item.item_content))
                  .join("\n")
              : ""),
        ),
      };
    }),
  );
}

async function observeContent(
  path: string,
  root: string,
): Promise<MineruReferencePack["content_json"]> {
  const metadata = await lstat(path);
  if (metadata.size > maximumContentBytes)
    throw new Error("REFERENCE_PACK_CONTENT_LIMIT");
  const bytes = await readFile(path);
  return {
    relative_path: relative(root, path).split("\\").join("/"),
    input_sha256: sha256Text(bytes.toString("utf8")),
    records: observeContentRecords(JSON.parse(bytes.toString("utf8"))),
  };
}

async function runBounded(
  command: string,
  arguments_: readonly string[],
  timeoutMs: number,
): Promise<string> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (error?: Error, output = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolvePromise(output);
    };
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > 1024 * 1024) {
        child.kill("SIGKILL");
        finish(new Error(`${command} output exceeded 1 MiB`));
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code !== 0) {
        finish(
          new Error(
            `${command} failed: ${Buffer.concat(stderr).toString("utf8").slice(0, 1_000)}`,
          ),
        );
      } else {
        finish(undefined, Buffer.concat(stdout).toString("utf8"));
      }
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`${command} timed out`));
    }, timeoutMs);
    timer.unref();
  });
}

async function inspectPdf(path: string): Promise<number> {
  const output = await runBounded("pdfinfo", [path], 30_000);
  const match = /^Pages:\s+(\d+)\s*$/mu.exec(output);
  const pages = match ? Number(match[1]) : 0;
  if (!Number.isSafeInteger(pages) || pages < 1 || pages > 100_000) {
    throw new Error("REFERENCE_PACK_PDF_PAGE_COUNT_INVALID");
  }
  return pages;
}

async function renderPdfPages(
  input: PdfRenderInput,
): Promise<readonly string[]> {
  const output: string[] = [];
  for (const pageIndex of input.pageIndices) {
    const stem = `page-${String(pageIndex + 1).padStart(4, "0")}`;
    await runBounded(
      "pdftoppm",
      [
        "-f",
        String(pageIndex + 1),
        "-l",
        String(pageIndex + 1),
        "-r",
        "110",
        "-png",
        "-singlefile",
        input.pdfPath,
        join(input.outputDirectory, stem),
      ],
      60_000,
    );
    output.push(`${stem}.png`);
  }
  return Object.freeze(output);
}

function checkedPageIndices(
  requested: readonly number[] | undefined,
  pageCount: number,
): readonly number[] {
  const pages = requested
    ? [...requested]
    : Array.from({ length: Math.min(pageCount, 48) }, (_, index) => index);
  if (
    pages.length > 100 ||
    pages.some(
      (page, index) =>
        !Number.isSafeInteger(page) ||
        page < 0 ||
        page >= pageCount ||
        (index > 0 && page <= (pages[index - 1] ?? -1)),
    )
  ) {
    throw new Error("REFERENCE_PACK_PAGE_INDICES_INVALID");
  }
  return Object.freeze(pages);
}

export async function createReferencePackFromArchive(
  input: ReferencePackInput,
): Promise<MineruReferencePack> {
  if (!fixtureIdPattern.test(input.fixtureId)) {
    throw new Error("REFERENCE_PACK_FIXTURE_ID_INVALID");
  }
  const outputDirectory = resolve(input.outputDirectory);
  const temporaryParent = resolve(input.temporaryParent ?? tmpdir());
  await mkdir(temporaryParent, { mode: 0o700, recursive: true });
  const temporaryRoot = await mkdtemp(
    join(temporaryParent, "mirawind-reference-pack-"),
  );
  let outputCreated = false;
  try {
    if (input.signal?.aborted) throw new Error("REFERENCE_PACK_CANCELED");
    const extractedRoot = join(temporaryRoot, "extracted");
    await extractZipFile({
      archivePath: resolve(input.archivePath),
      destination: extractedRoot,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const files = await regularFiles(extractedRoot);
    const contentPaths = files.filter((path) =>
      /(?:^|_)content_list_v2\.json$/iu.test(basename(path)),
    );
    const pdfPaths = files.filter((path) =>
      path.toLowerCase().endsWith(".pdf"),
    );
    const contentPath = contentPaths[0];
    if (!contentPath || contentPaths.length !== 1)
      throw new Error("REFERENCE_PACK_CONTENT_INVALID");
    if (pdfPaths.length < 1) throw new Error("REFERENCE_PACK_PDF_MISSING");

    await mkdir(outputDirectory, { mode: 0o700, recursive: false });
    outputCreated = true;
    const contentJson = await observeContent(contentPath, extractedRoot);
    const pdfDocuments = [];
    for (const [pdfIndex, pdfPath] of pdfPaths.entries()) {
      const pageCount = await (input.pdfInspector ?? inspectPdf)(pdfPath);
      const pageIndices = checkedPageIndices(input.pageIndices, pageCount);
      const pagesDirectory = join(
        outputDirectory,
        "pages",
        `pdf-${String(pdfIndex).padStart(3, "0")}`,
      );
      await mkdir(pagesDirectory, { mode: 0o700, recursive: true });
      const rendered = await (input.pdfRenderer ?? renderPdfPages)({
        outputDirectory: pagesDirectory,
        pageIndices,
        pdfPath,
      });
      if (rendered.length !== pageIndices.length) {
        throw new Error("REFERENCE_PACK_RENDERED_PAGE_COUNT_MISMATCH");
      }
      const renderedPages = [];
      for (const [index, name] of rendered.entries()) {
        if (basename(name) !== name || name.includes("\\")) {
          throw new Error("REFERENCE_PACK_RENDERED_PAGE_PATH_INVALID");
        }
        const imagePath = join(pagesDirectory, name);
        const metadata = await lstat(imagePath);
        if (!metadata.isFile() || metadata.isSymbolicLink()) {
          throw new Error("REFERENCE_PACK_RENDERED_PAGE_INVALID");
        }
        renderedPages.push(
          Object.freeze({
            page_index: pageIndices[index] ?? 0,
            relative_path: relative(outputDirectory, imagePath)
              .split("\\")
              .join("/"),
            sha256: await sha256File(imagePath),
          }),
        );
      }
      pdfDocuments.push(
        Object.freeze({
          page_count: pageCount,
          relative_path: relative(extractedRoot, pdfPath).split("\\").join("/"),
          rendered_pages: Object.freeze(renderedPages),
          sha256: await sha256File(pdfPath),
        }),
      );
    }
    const sidecarPaths = files.filter((path) =>
      /(?:^|\/)(?:content_list|[^/]+_content_list|[^/]+_content_list_v2)\.json$/iu.test(
        relative(extractedRoot, path).split("\\").join("/"),
      ),
    );
    const sidecars = [];
    for (const path of sidecarPaths) {
      const metadata = await lstat(path);
      sidecars.push(
        Object.freeze({
          relative_path: relative(extractedRoot, path).split("\\").join("/"),
          sha256: await sha256File(path),
          size_bytes: metadata.size,
        }),
      );
    }
    const result: MineruReferencePack = Object.freeze({
      archive_sha256: await sha256File(resolve(input.archivePath)),
      fixture_id: input.fixtureId,
      content_json: contentJson,
      pdf_documents: Object.freeze(pdfDocuments),
      schema_version: 2,
      sidecars: Object.freeze(sidecars),
    });
    await writeFile(
      join(outputDirectory, "observations.json"),
      `${JSON.stringify(result, null, 2)}\n`,
      { mode: 0o600 },
    );
    return result;
  } catch (error) {
    if (outputCreated) {
      await rm(outputDirectory, { force: true, recursive: true });
    }
    throw error;
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

function argumentsMap(arguments_: readonly string[]): Map<string, string> {
  const normalized = arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
  const values = new Map<string, string>();
  for (let index = 0; index < normalized.length; index += 2) {
    const name = normalized[index];
    const value = normalized[index + 1];
    if (
      !name ||
      !["--fixture", "--output", "--pages", "--real-dir"].includes(name) ||
      !value ||
      values.has(name)
    ) {
      throw new Error("Arguments must be unique --name value pairs");
    }
    values.set(name, value);
  }
  return values;
}

function parsePageSelection(
  value: string | undefined,
): readonly number[] | undefined {
  if (!value) return undefined;
  const output = new Set<number>();
  for (const part of value.split(",")) {
    const range = /^(\d+)(?:-(\d+))?$/u.exec(part);
    if (!range) throw new Error("--pages must use zero-based N or N-M values");
    const start = Number(range[1]);
    const end = Number(range[2] ?? range[1]);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      end < start ||
      end - start > 100
    ) {
      throw new Error("--pages contains an invalid range");
    }
    for (let page = start; page <= end; page += 1) output.add(page);
  }
  return Object.freeze([...output].sort((left, right) => left - right));
}

async function main(): Promise<void> {
  const values = argumentsMap(process.argv.slice(2));
  const fixtureId = values.get("--fixture");
  const output = values.get("--output");
  const realDirectory = values.get("--real-dir");
  if (!fixtureId || !output || !realDirectory) {
    throw new Error("Required: --real-dir --fixture --output");
  }
  const root = resolve(realDirectory);
  const manifest = parseRealFixtureManifest(
    JSON.parse(
      await readFile(join(root, "real-fixtures.json"), "utf8"),
    ) as unknown,
  );
  const fixture = manifest.fixtures.find((item) => item.id === fixtureId);
  if (!fixture) throw new Error("The fixture is not registered");
  const verified = await verifyRealMineruFixtures(root, undefined, [fixtureId]);
  if (!verified.some((item) => item.id === fixtureId)) {
    throw new Error("The fixture failed verification");
  }
  const selectedPages = parsePageSelection(values.get("--pages"));
  const result = await createReferencePackFromArchive({
    archivePath: join(root, fixture.file_name),
    fixtureId,
    outputDirectory: resolve(output),
    ...(selectedPages ? { pageIndices: selectedPages } : {}),
  });
  process.stdout.write(
    `${JSON.stringify({
      fixture_id: result.fixture_id,
      content_records: result.content_json.records.length,
      pdf_documents: result.pdf_documents.length,
      rendered_pages: result.pdf_documents.reduce(
        (total, pdf) => total + pdf.rendered_pages.length,
        0,
      ),
    })}\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
