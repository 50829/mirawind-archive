import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const identity = "mirawind-reader-v2-tailwind-4.3.3";
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputFlag = process.argv.indexOf("--output");
if (outputFlag >= 0 && !process.argv[outputFlag + 1]) {
  throw new Error("READER_ASSET_OUTPUT_REQUIRED");
}
const outputPath = resolve(
  outputFlag >= 0
    ? process.argv[outputFlag + 1]
    : resolve(projectRoot, "public", "_astro", "scripts", `${identity}.js`),
);
const defaultOutput = outputFlag < 0;

if (defaultOutput) {
  await Promise.all(
    ["scripts", "styles"].map((directory) =>
      rm(resolve(projectRoot, "public", "_astro", directory), {
        force: true,
        recursive: true,
      }),
    ),
  );
} else {
  await rm(outputPath, { force: true });
}
await mkdir(dirname(outputPath), { mode: 0o755, recursive: true });
await copyFile(
  resolve(projectRoot, "src", "components", "reader", "reader-runtime.js"),
  outputPath,
);
