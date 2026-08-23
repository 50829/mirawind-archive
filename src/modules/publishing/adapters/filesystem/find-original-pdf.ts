import { constants, lstat, open, readdir } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { PdfSourceDiagnostic } from "../../core/preparation/pdf-evidence-model";

export type OriginalPdfDiscovery =
  { readonly pdfPath: string } | { readonly diagnostic: PdfSourceDiagnostic };

const maximumEntries = 20_000;
const debugPdf = /(?:^|[_-])(?:layout|span|spans|model|line[_-]?sort)\.pdf$/iu;
const originPdf = /(?:^|[_-])origin\.pdf$/iu;

function checkCanceled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("PDF_CONTENTS_SOURCE_CANCELED");
}

function assertContained(root: string, target: string): void {
  const relation = relative(root, target);
  if (
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    throw new Error("PDF_CONTENTS_SOURCE_PATH_INVALID");
  }
}

async function hasPdfMagic(path: string): Promise<boolean> {
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) return false;
    const bytes = Buffer.alloc(5);
    const result = await handle.read(bytes, 0, bytes.byteLength, 0);
    return (
      result.bytesRead === bytes.byteLength &&
      bytes.equals(Buffer.from("%PDF-"))
    );
  } finally {
    await handle.close();
  }
}

export async function findOriginalPdf(input: {
  readonly bundleRoot: string;
  readonly markdownPath: string;
  readonly signal?: AbortSignal;
}): Promise<OriginalPdfDiscovery> {
  const bundleRoot = resolve(input.bundleRoot);
  const markdownPath = resolve(input.markdownPath);
  assertContained(bundleRoot, markdownPath);
  checkCanceled(input.signal);

  const directories = [bundleRoot];
  const candidates: string[] = [];
  let seen = 0;
  while (directories.length > 0) {
    checkCanceled(input.signal);
    const directory = directories.shift();
    if (!directory) break;
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      checkCanceled(input.signal);
      seen += 1;
      if (seen > maximumEntries) {
        throw new Error("PDF_CONTENTS_SOURCE_LIMIT_EXCEEDED");
      }
      const path = resolve(directory, entry.name);
      assertContained(bundleRoot, path);
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) {
        throw new Error("PDF_CONTENTS_SOURCE_SPECIAL_FILE");
      }
      if (metadata.isDirectory()) {
        directories.push(path);
        continue;
      }
      if (!metadata.isFile()) {
        throw new Error("PDF_CONTENTS_SOURCE_SPECIAL_FILE");
      }
      if (
        !entry.name.toLowerCase().endsWith(".pdf") ||
        debugPdf.test(entry.name)
      ) {
        continue;
      }
      if (await hasPdfMagic(path)) candidates.push(path);
    }
  }

  const preferred = candidates.filter((path) => originPdf.test(path));
  const eligible = preferred.length > 0 ? preferred : candidates;
  if (eligible.length === 1 && eligible[0]) {
    return Object.freeze({ pdfPath: eligible[0] });
  }
  return Object.freeze({
    diagnostic:
      eligible.length === 0
        ? "PDF_CONTENTS_SOURCE_UNAVAILABLE"
        : "PDF_CONTENTS_SOURCE_AMBIGUOUS",
  });
}
