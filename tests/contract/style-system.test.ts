import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { readerStylesheetIdentity, readerStylesheetUrl } from "@/styles/assets";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "../..");
const generatedRoots: string[] = [];

async function astroPagesUnder(directory: string): Promise<string[]> {
  const pages: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) pages.push(...(await astroPagesUnder(path)));
    else if (entry.isFile() && entry.name.endsWith(".astro")) pages.push(path);
  }
  return pages;
}

afterEach(async () => {
  await Promise.all(
    generatedRoots
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("global Tailwind style system", () => {
  it("pins the Tailwind toolchain and enables the official Vite plugin", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(projectRoot, "package.json"), "utf8"),
    ) as {
      devDependencies: Record<string, string>;
    };
    const astroConfig = await readFile(
      resolve(projectRoot, "astro.config.mjs"),
      "utf8",
    );

    expect(packageJson.devDependencies).toMatchObject({
      "@tailwindcss/cli": "4.3.3",
      "@tailwindcss/vite": "4.3.3",
      tailwindcss: "4.3.3",
    });
    expect(astroConfig).toContain('from "@tailwindcss/vite"');
    expect(astroConfig).toContain("plugins: [tailwindcss()]");
  });

  it("loads the global theme from every Astro page", async () => {
    const pages = await astroPagesUnder(resolve(projectRoot, "src/pages"));

    expect(pages).not.toHaveLength(0);
    for (const page of pages) {
      expect(await readFile(page, "utf8")).toContain(
        'import "@/styles/global.css";',
      );
    }
  });

  it("rejects product color literals and compiles the reader stylesheet", async () => {
    await execFileAsync("node", ["scripts/check-style-tokens.mjs"], {
      cwd: projectRoot,
    });

    const outputRoot = await mkdtemp(join(tmpdir(), "mirawind-tailwind-"));
    generatedRoots.push(outputRoot);
    const outputPath = resolve(outputRoot, "reader.css");
    await execFileAsync(
      resolve(projectRoot, "node_modules/.bin/tailwindcss"),
      [
        "-i",
        "src/styles/reader.css",
        "-o",
        outputPath,
        "--cwd",
        projectRoot,
        "--minify",
      ],
      { cwd: projectRoot },
    );
    const css = await readFile(outputPath, "utf8");

    expect(readerStylesheetIdentity).toBe("mirawind-reader-v2-tailwind-4.3.3");
    expect(readerStylesheetUrl).toBe(
      "/reader-assets/styles/mirawind-reader-v2-tailwind-4.3.3.css",
    );
    expect(css).toContain(".reader-layout");
    expect(css).toContain("var(--color-emerald-800)");
    for (const level of ["h1", "h2", "h3", "h4"] as const) {
      expect(css).toContain(`.reader-document ${level}`);
    }
  });
});
