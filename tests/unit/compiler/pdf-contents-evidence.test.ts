import {
  access,
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { watch } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  readPdfContentsEvidence,
  type PdfContentsEvidenceCommands,
} from "@/modules/publishing/adapters/filesystem/read-pdf-contents-evidence";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function executable(path: string, body: string): Promise<string> {
  await writeFile(path, `#!/bin/sh\nset -eu\n${body}\n`);
  await chmod(path, 0o700);
  return path;
}

async function fixture(
  input: {
    readonly nativeText?: string;
    readonly pages?: number;
    readonly tesseractBody?: string;
  } = {},
): Promise<{
  readonly commands: PdfContentsEvidenceCommands;
  readonly pdfPath: string;
  readonly root: string;
  readonly work: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "mirawind-ocr-test-"));
  temporaryRoots.push(root);
  const work = join(root, "work");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(work));
  const pdfPath = join(root, "input.pdf");
  await writeFile(pdfPath, "fake pdf");
  const pdfinfo = await executable(
    join(root, "pdfinfo"),
    `printf 'Pages: ${input.pages ?? 2}\\n'`,
  );
  const escapedNative = (input.nativeText ?? "\f\f").replaceAll("'", "'\\''");
  const pdftotext = await executable(
    join(root, "pdftotext"),
    `printf '${escapedNative}'`,
  );
  const pdftoppm = await executable(
    join(root, "pdftoppm"),
    'printf \'%s\\n\' "$*" >> "$0.log"\nfor last do :; done\n: > "${last}.png"',
  );
  const defaultTesseract = [
    'printf \'%s\\n\' "$*" >> "$0.log"',
    "printf 'level\\tpage_num\\tblock_num\\tpar_num\\tline_num\\tword_num\\tleft\\ttop\\twidth\\theight\\tconf\\ttext\\n'",
    "printf '5\\t1\\t1\\t1\\t1\\t1\\t10\\t20\\t40\\t12\\t95\\tChapter\\n'",
    "printf '5\\t1\\t1\\t1\\t1\\t2\\t55\\t20\\t50\\t12\\t93\\tStart....1\\n'",
  ].join("\n");
  const tesseract = await executable(
    join(root, "tesseract"),
    input.tesseractBody ?? defaultTesseract,
  );
  return {
    commands: { pdfinfo, pdftoppm, pdftotext, tesseract },
    pdfPath,
    root,
    work,
  };
}

describe("bounded PDF contents evidence", () => {
  it("rejects non-TSV native output instead of using the removed parser", async () => {
    const value = await fixture({
      nativeText: "Contents\\nChapter 1 Start .... 1\\nChapter 2 End .... 9\\f",
    });

    const result = await readPdfContentsEvidence({
      allowOcr: false,
      commands: value.commands,
      pdfPath: value.pdfPath,
      temporaryRoot: value.work,
    });

    expect(result).toMatchObject({
      inspectedPageIndices: [],
      records: [],
      source: "none",
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "PDF_CONTENTS_NATIVE_ABSENT" }),
    );
    await expect(access(`${value.commands.pdftoppm}.log`)).rejects.toThrow();
    expect(await readdir(value.work)).toEqual([]);
  });

  it("preserves native PDF line boxes from Poppler TSV output", async () => {
    const value = await fixture({
      nativeText: [
        "level\tpage_num\tpar_num\tblock_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
        "1\t1\t0\t0\t0\t0\t0\t0\t600\t800\t-1\t###PAGE###",
        "5\t1\t1\t1\t1\t1\t10\t20\t55\t12\t100\tContents",
        "5\t1\t1\t1\t2\t1\t10\t40\t45\t12\t100\tChapter",
        "5\t1\t1\t1\t2\t2\t60\t40\t10\t12\t100\t1",
        "5\t1\t1\t1\t2\t3\t75\t40\t40\t12\t100\tStart",
        "5\t1\t1\t1\t2\t4\t120\t40\t40\t12\t100\t....1",
        "5\t1\t2\t1\t1\t1\t320\t20\t45\t12\t100\tChapter",
        "5\t1\t2\t1\t1\t2\t370\t20\t10\t12\t100\t2",
        "5\t1\t2\t1\t1\t3\t385\t20\t35\t12\t100\tEnd",
        "5\t1\t2\t1\t1\t4\t425\t20\t35\t12\t100\t....9",
      ].join("\n"),
    });

    const result = await readPdfContentsEvidence({
      commands: value.commands,
      pdfPath: value.pdfPath,
      temporaryRoot: value.work,
    });

    expect(result.source).toBe("native-pdf");
    expect(result.inspectedPageIndices).toEqual([0]);
    expect(result.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bbox: [10, 40, 160, 52],
          pageIndex: 0,
          text: "Chapter 1 Start ....1",
        }),
        expect.objectContaining({
          bbox: [320, 20, 460, 32],
          pageIndex: 0,
          text: "Chapter 2 End ....9",
        }),
      ]),
    );
  });

  it("removes a repeated native extraction ordinal after printed page labels", async () => {
    const rows = [
      ["复数", "2", "8"],
      ["组", "4", "9"],
      ["Fn", "5", "10"],
      ["关于域", "8", "11"],
      ["习题", "9", "12"],
    ];
    const nativeText = [
      "level\tpage_num\tpar_num\tblock_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
      "1\t1\t0\t0\t0\t0\t0\t0\t600\t800\t-1\t###PAGE###",
      "5\t1\t1\t1\t1\t1\t10\t20\t55\t12\t100\tContents",
      ...rows.flatMap(([title, page, ordinal], index) => [
        `5\t1\t1\t1\t${index + 2}\t1\t10\t${40 + index * 20}\t80\t12\t100\t${title}`,
        `5\t1\t1\t1\t${index + 2}\t2\t95\t${40 + index * 20}\t80\t12\t100\t....`,
        `5\t1\t1\t1\t${index + 2}\t3\t180\t${40 + index * 20}\t20\t12\t100\t${page}`,
        `5\t1\t1\t1\t${index + 2}\t4\t205\t${40 + index * 20}\t20\t12\t100\t${ordinal}`,
      ]),
    ].join("\n");
    const value = await fixture({ nativeText });

    const result = await readPdfContentsEvidence({
      commands: value.commands,
      pdfPath: value.pdfPath,
      recoverPageLabels: true,
      temporaryRoot: value.work,
    });

    expect(result.source).toBe("native-pdf");
    expect(result.records.map((record) => record.text)).toEqual(
      expect.arrayContaining([
        "复数 .... 2",
        "组 .... 4",
        "Fn .... 5",
        "关于域 .... 8",
        "习题 .... 9",
      ]),
    );
    await expect(access(`${value.commands.pdftoppm}.log`)).rejects.toThrow();
  });

  it("uses OCR when native text exists but has no contents boundary", async () => {
    const value = await fixture({
      nativeText: "Cover\nCopyright\fPreface\nIntroduction\f",
    });

    const result = await readPdfContentsEvidence({
      commands: value.commands,
      pageIndices: [0],
      pdfPath: value.pdfPath,
      temporaryRoot: value.work,
    });

    expect(result.source).toBe("ocr");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "PDF_CONTENTS_NATIVE_ABSENT" }),
    );
    expect(await readFile(`${value.commands.pdftoppm}.log`, "utf8")).toContain(
      "-f 1 -l 1 -r 150",
    );
  });

  it("can stop after native evidence without rasterizing supplemental pages", async () => {
    const value = await fixture({
      nativeText: "Cover\nCopyright\fPreface\nIntroduction\f",
    });

    const result = await readPdfContentsEvidence({
      allowOcr: false,
      commands: value.commands,
      pdfPath: value.pdfPath,
      temporaryRoot: value.work,
    });

    expect(result).toMatchObject({ records: [], source: "none" });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "PDF_CONTENTS_NATIVE_ABSENT" }),
    );
    await expect(access(`${value.commands.pdftoppm}.log`)).rejects.toThrow();
  });

  it("rasterizes only requested front pages at 150 DPI with both languages", async () => {
    const value = await fixture();

    const result = await readPdfContentsEvidence({
      commands: value.commands,
      pageIndices: [0, 1],
      pdfPath: value.pdfPath,
      temporaryRoot: value.work,
    });

    expect(result.source).toBe("ocr");
    expect(result.inspectedPageIndices).toEqual([0, 1]);
    expect(result.records).toHaveLength(2);
    const rasterLog = await readFile(`${value.commands.pdftoppm}.log`, "utf8");
    expect(rasterLog).toContain("-f 1 -l 1 -r 150 -png -singlefile");
    expect(rasterLog).toContain("-f 2 -l 2 -r 150 -png -singlefile");
    const ocrLog = await readFile(`${value.commands.tesseract}.log`, "utf8");
    expect(ocrLog).toContain("-l eng+chi_sim --psm 6 tsv");
    expect(await readdir(value.work)).toEqual([]);
  });

  it("retains a confident right-column page digit when its OCR line is noisy", async () => {
    const value = await fixture({
      tesseractBody: [
        'printf \'%s\\n\' "$*" >> "$0.log"',
        "printf 'level\\tpage_num\\tblock_num\\tpar_num\\tline_num\\tword_num\\tleft\\ttop\\twidth\\theight\\tconf\\ttext\\n'",
        "printf '5\\t1\\t1\\t1\\t1\\t1\\t60\\t100\\t300\\t18\\t0\\tUnreadable\\n'",
        "printf '5\\t1\\t1\\t1\\t1\\t2\\t980\\t100\\t12\\t18\\t92\\t1\\n'",
        "printf '5\\t1\\t1\\t1\\t2\\t1\\t60\\t140\\t300\\t18\\t95\\tReadable\\n'",
        "printf '5\\t1\\t1\\t1\\t2\\t2\\t980\\t140\\t12\\t18\\t94\\t2\\n'",
      ].join("\n"),
    });

    const result = await readPdfContentsEvidence({
      commands: value.commands,
      pageIndices: [0],
      pdfPath: value.pdfPath,
      recoverPageLabels: true,
      temporaryRoot: value.work,
    });

    expect(result.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bbox: [980, 100, 992, 118],
          text: "1",
          type: "page-label",
        }),
      ]),
    );
    const ocrLog = await readFile(`${value.commands.tesseract}.log`, "utf8");
    expect(ocrLog).toContain("-l eng+chi_sim --psm 6 tsv");
    expect(ocrLog).toContain("-l eng+chi_sim --psm 3 tsv");
  });

  it("rejects pages outside the first 48 before rasterization", async () => {
    const value = await fixture({ pages: 60 });

    await expect(
      readPdfContentsEvidence({
        commands: value.commands,
        pageIndices: [48],
        pdfPath: value.pdfPath,
        temporaryRoot: value.work,
      }),
    ).rejects.toThrow("PDF_CONTENTS_EVIDENCE_PAGE_LIMIT");
    await expect(access(`${value.commands.pdftoppm}.log`)).rejects.toThrow();
    expect(await readdir(value.work)).toEqual([]);
  });

  it("bounds per-page execution and removes temporary rasters", async () => {
    const value = await fixture({ tesseractBody: "sleep 5" });

    const result = await readPdfContentsEvidence({
      commands: value.commands,
      limits: { aggregateTimeoutMs: 120, pageTimeoutMs: 60 },
      pageIndices: [0],
      pdfPath: value.pdfPath,
      temporaryRoot: value.work,
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "PDF_CONTENTS_OCR_TIMEOUT",
        pageIndex: 0,
      }),
    );
    expect(result.records).toEqual([]);
    expect(await readdir(value.work)).toEqual([]);
  });

  it("propagates cancellation and removes temporary rasters", async () => {
    const value = await fixture({
      tesseractBody: ': > "$0.started"\nsleep 5',
    });
    const controller = new AbortController();
    const started = new Promise<void>((resolveStarted, rejectStarted) => {
      const watcher = watch(value.root, (_event, fileName) => {
        if (fileName !== "tesseract.started") return;
        watcher.close();
        resolveStarted();
      });
      watcher.once("error", rejectStarted);
    });
    const pending = readPdfContentsEvidence({
      commands: value.commands,
      pageIndices: [0],
      pdfPath: value.pdfPath,
      signal: controller.signal,
      temporaryRoot: value.work,
    });
    await started;
    controller.abort();

    await expect(pending).rejects.toThrow();
    expect(await readdir(value.work)).toEqual([]);
  });

  it("reports unavailable tools and low-confidence output without accepting text", async () => {
    const unavailable = await fixture();
    const missing = await readPdfContentsEvidence({
      commands: {
        ...unavailable.commands,
        tesseract: join(unavailable.root, "missing-tesseract"),
      },
      pageIndices: [0],
      pdfPath: unavailable.pdfPath,
      temporaryRoot: unavailable.work,
    });
    expect(missing).toMatchObject({
      records: [],
      source: "none",
    });
    expect(missing.diagnostics).toContainEqual(
      expect.objectContaining({ code: "PDF_CONTENTS_TOOL_UNAVAILABLE" }),
    );
    expect(await readdir(unavailable.work)).toEqual([]);

    const low = await fixture({
      tesseractBody: [
        "printf 'level\\tpage_num\\tblock_num\\tpar_num\\tline_num\\tword_num\\tleft\\ttop\\twidth\\theight\\tconf\\ttext\\n'",
        "printf '5\\t1\\t1\\t1\\t1\\t1\\t10\\t20\\t40\\t12\\t10\\tUnreadable\\n'",
      ].join("\n"),
    });
    const lowResult = await readPdfContentsEvidence({
      commands: low.commands,
      pageIndices: [0],
      pdfPath: low.pdfPath,
      temporaryRoot: low.work,
    });
    expect(lowResult.records).toEqual([]);
    expect(lowResult.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "PDF_CONTENTS_OCR_LOW_CONFIDENCE",
        pageIndex: 0,
      }),
    );
    expect(await readdir(low.work)).toEqual([]);
  });
});
