import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildZip, type ZipBuildOptions } from "./zip-builder.js";

interface HostileFixtureDefinition {
  readonly expectedCategory: string;
  readonly fileName: string;
  readonly make: () => Buffer;
}

const markdown = "# Synthetic archive fixture\n";
const unixSymlinkAttributes = (0o120777 << 16) >>> 0;
const unixFifoAttributes = (0o010644 << 16) >>> 0;

function zip(entries: ZipBuildOptions["entries"], options = {}): Buffer {
  return buildZip({ entries, ...options });
}

function definitions(): readonly HostileFixtureDefinition[] {
  const deepPath = `${Array.from({ length: 21 }, (_, index) => `d${index}`).join("/")}/book.md`;
  const longComponent = `${"é".repeat(128)}.md`;
  const longPath = `${Array.from({ length: 9 }, (_, index) => `${index}${"a".repeat(228)}`).join("/")}/book.md`;
  return [
    {
      expectedCategory: "accepted-control",
      fileName: "valid-control.zip",
      make: () => zip([{ data: markdown, name: "book/full.md" }]),
    },
    {
      expectedCategory: "archive-path",
      fileName: "parent-traversal.zip",
      make: () => zip([{ data: markdown, name: "../escape.md" }]),
    },
    {
      expectedCategory: "archive-path",
      fileName: "backslash-traversal.zip",
      make: () => zip([{ data: markdown, name: "..\\escape.md" }]),
    },
    {
      expectedCategory: "archive-path",
      fileName: "absolute-posix.zip",
      make: () => zip([{ data: markdown, name: "/absolute.md" }]),
    },
    {
      expectedCategory: "archive-path",
      fileName: "absolute-drive.zip",
      make: () => zip([{ data: markdown, name: "C:/absolute.md" }]),
    },
    {
      expectedCategory: "archive-collision",
      fileName: "duplicate-path.zip",
      make: () =>
        zip([
          { data: "first", name: "book/full.md" },
          { data: "second", name: "book/full.md" },
        ]),
    },
    {
      expectedCategory: "archive-collision",
      fileName: "unicode-normalization-collision.zip",
      make: () =>
        zip([
          { data: "first", name: "book/café.md" },
          { data: "second", name: "book/cafe\u0301.md" },
        ]),
    },
    {
      expectedCategory: "archive-special-file",
      fileName: "symlink.zip",
      make: () =>
        zip([
          {
            data: "../outside",
            externalAttributes: unixSymlinkAttributes,
            name: "book/link",
          },
        ]),
    },
    {
      expectedCategory: "archive-special-file",
      fileName: "fifo.zip",
      make: () =>
        zip([
          {
            externalAttributes: unixFifoAttributes,
            name: "book/pipe",
          },
        ]),
    },
    {
      expectedCategory: "archive-encrypted",
      fileName: "encrypted-flag.zip",
      make: () =>
        zip([{ data: markdown, flags: 0x0001, name: "book/full.md" }]),
    },
    {
      expectedCategory: "archive-compression",
      fileName: "unsupported-compression.zip",
      make: () => zip([{ data: markdown, method: 99, name: "book/full.md" }]),
    },
    {
      expectedCategory: "archive-multi-disk",
      fileName: "multi-disk.zip",
      make: () =>
        zip([{ data: markdown, name: "book/full.md" }], {
          centralDirectoryDisk: 1,
          eocdDisk: 1,
        }),
    },
    {
      expectedCategory: "archive-malformed",
      fileName: "truncated-central-directory.zip",
      make: () => {
        const valid = zip([{ data: markdown, name: "book/full.md" }]);
        return valid.subarray(0, valid.length - 12);
      },
    },
    {
      expectedCategory: "archive-malformed",
      fileName: "local-central-name-mismatch.zip",
      make: () =>
        zip([
          {
            centralName: "book/other.md",
            data: markdown,
            name: "book/full.md",
          },
        ]),
    },
    {
      expectedCategory: "archive-depth-limit",
      fileName: "depth-over-limit.zip",
      make: () => zip([{ data: markdown, name: deepPath }]),
    },
    {
      expectedCategory: "archive-component-limit",
      fileName: "component-over-limit.zip",
      make: () => zip([{ data: markdown, name: longComponent }]),
    },
    {
      expectedCategory: "archive-path-limit",
      fileName: "path-over-limit.zip",
      make: () => zip([{ data: markdown, name: longPath }]),
    },
    {
      expectedCategory: "archive-expansion-ratio",
      fileName: "ratio-over-limit.zip",
      make: () =>
        zip([
          {
            data: Buffer.alloc(64 * 1024 * 1024 + 1, 0x41),
            method: 8,
            name: "book/full.md",
          },
        ]),
    },
    {
      expectedCategory: "archive-entry-limit",
      fileName: "entry-count-over-limit.zip",
      make: () =>
        zip(
          Array.from({ length: 20_001 }, (_, index) => ({
            name: `entries/${index.toString().padStart(5, "0")}`,
          })),
        ),
    },
    {
      expectedCategory: "archive-metadata-mismatch",
      fileName: "declared-size-lie.zip",
      make: () =>
        zip([
          {
            data: markdown,
            declaredUncompressedSize: 1,
            name: "book/full.md",
          },
        ]),
    },
  ];
}

export async function buildHostileZipFixtures(
  outputDirectoryInput: string,
): Promise<
  readonly {
    readonly expected_category: string;
    readonly file_name: string;
    readonly sha256: string;
    readonly size_bytes: number;
  }[]
> {
  const outputDirectory = resolve(outputDirectoryInput);
  await mkdir(outputDirectory, { mode: 0o700, recursive: true });
  const manifest = [];
  for (const definition of definitions()) {
    const content = definition.make();
    await writeFile(resolve(outputDirectory, definition.fileName), content, {
      mode: 0o600,
    });
    manifest.push({
      expected_category: definition.expectedCategory,
      file_name: definition.fileName,
      sha256: createHash("sha256").update(content).digest("hex"),
      size_bytes: content.length,
    });
  }
  await writeFile(
    resolve(outputDirectory, "manifest.json"),
    `${JSON.stringify({ fixtures: manifest, schema_version: 1 }, null, 2)}\n`,
    { mode: 0o600 },
  );
  return Object.freeze(manifest.map((entry) => Object.freeze(entry)));
}

function outputArgument(arguments_: readonly string[]): string {
  const index = arguments_.indexOf("--output");
  const output = index >= 0 ? arguments_[index + 1] : undefined;
  if (!output || arguments_.length !== 2) {
    throw new Error("Usage: build-hostile-zips --output <directory>");
  }
  return output;
}

async function main(): Promise<void> {
  const manifest = await buildHostileZipFixtures(
    outputArgument(process.argv.slice(2)),
  );
  process.stdout.write(
    `${JSON.stringify({ fixtures: manifest.length, status: "generated" })}\n`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Fixture generation failed"}\n`,
    );
    process.exitCode = 1;
  });
}
