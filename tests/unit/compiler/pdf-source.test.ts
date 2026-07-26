import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { findOriginalPdf } from "@/compiler/document/pdf-source";
import { createTemporaryDataRoot } from "../../helpers/data-root.js";

describe("original PDF discovery", () => {
  it("prefers the unique origin PDF and excludes renderer diagnostics", async () => {
    const root = await createTemporaryDataRoot("pdf-source");
    try {
      const bundle = resolve(root.path, "bundle");
      await mkdir(bundle);
      const markdownPath = resolve(bundle, "book.md");
      await writeFile(markdownPath, "# Book\n");
      await writeFile(resolve(bundle, "book_origin.pdf"), "%PDF-origin");
      await writeFile(resolve(bundle, "book_layout.pdf"), "%PDF-layout");
      await writeFile(resolve(bundle, "book_span.pdf"), "%PDF-span");

      await expect(
        findOriginalPdf({ bundleRoot: bundle, markdownPath }),
      ).resolves.toEqual({ pdfPath: resolve(bundle, "book_origin.pdf") });
    } finally {
      await root.cleanup();
    }
  });

  it("does not guess between multiple non-origin PDFs", async () => {
    const root = await createTemporaryDataRoot("pdf-source-ambiguous");
    try {
      const bundle = resolve(root.path, "bundle");
      await mkdir(bundle);
      const markdownPath = resolve(bundle, "book.md");
      await writeFile(markdownPath, "# Book\n");
      await writeFile(resolve(bundle, "one.pdf"), "%PDF-one");
      await writeFile(resolve(bundle, "two.pdf"), "%PDF-two");

      await expect(
        findOriginalPdf({ bundleRoot: bundle, markdownPath }),
      ).resolves.toEqual({ diagnostic: "PDF_CONTENTS_SOURCE_AMBIGUOUS" });
    } finally {
      await root.cleanup();
    }
  });

  it("ignores invalid PDF bytes and obeys cancellation", async () => {
    const root = await createTemporaryDataRoot("pdf-source-invalid");
    try {
      const bundle = resolve(root.path, "bundle");
      await mkdir(bundle);
      const markdownPath = resolve(bundle, "book.md");
      await writeFile(markdownPath, "# Book\n");
      await writeFile(resolve(bundle, "book_origin.pdf"), "not a pdf");

      await expect(
        findOriginalPdf({ bundleRoot: bundle, markdownPath }),
      ).resolves.toEqual({ diagnostic: "PDF_CONTENTS_SOURCE_UNAVAILABLE" });

      const controller = new AbortController();
      controller.abort();
      await expect(
        findOriginalPdf({
          bundleRoot: bundle,
          markdownPath,
          signal: controller.signal,
        }),
      ).rejects.toThrow("PDF_CONTENTS_SOURCE_CANCELED");
    } finally {
      await root.cleanup();
    }
  });
});
