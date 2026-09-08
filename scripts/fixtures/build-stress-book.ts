import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildZip, type ZipEntryInput } from "./zip-builder.js";

const stressPixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

export interface StressBookOptions {
  readonly blocksPerPage: number;
  readonly imageCount: number;
  readonly pages: number;
}

function boundedInteger(
  value: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${label} must be an integer from ${minimum} to ${maximum}`,
    );
  }
  return value;
}

function token(page: number, block: number): string {
  return createHash("sha256")
    .update(`mirawind-stress-v1:${page}:${block}`)
    .digest("hex")
    .slice(0, 16);
}

export function buildStressBook(options: StressBookOptions): {
  readonly bytes: Buffer;
  readonly metadata: {
    readonly blocks_per_page: number;
    readonly image_count: number;
    readonly pages: number;
    readonly sha256: string;
    readonly size_bytes: number;
  };
} {
  const pages = boundedInteger(options.pages, "pages", 1, 2_000);
  const blocksPerPage = boundedInteger(
    options.blocksPerPage,
    "blocksPerPage",
    1,
    100,
  );
  const imageCount = boundedInteger(options.imageCount, "imageCount", 0, 500);
  const text = (content: string) => ({ type: "text", content });
  const title = (content: string) => ({
    type: "title",
    content: { level: 1, title_content: [text(content)] },
  });
  const paragraph = (content: string) => ({
    type: "paragraph",
    content: { paragraph_content: [text(content)] },
  });
  const contentList: Record<string, unknown>[][] = [
    [
      title("Mirawind deterministic synthetic stress book"),
      paragraph("This generated document contains no source-book content."),
    ],
  ];

  for (let page = 1; page <= pages; page += 1) {
    const heading = `Page ${page.toString().padStart(4, "0")} 混合语言章节`;
    const content: Record<string, unknown>[] = [title(heading)];
    for (let block = 1; block <= blocksPerPage; block += 1) {
      const identity = token(page, block);
      content.push(
        paragraph(
          `Synthetic paragraph ${page}.${block} token ${identity}. 中文连续检索样本，TypeScript and SQLite mixed-language evidence.`,
        ),
      );
    }
    if (imageCount > 0) {
      const image = (page - 1) % imageCount;
      content.push({
        type: "image",
        content: {
          image_source: {
            path: `images/image-${image.toString().padStart(3, "0")}.png`,
          },
          image_caption: [text(`Synthetic stress image ${image}`)],
          image_footnote: [],
        },
      });
    }
    content.push({
      type: "paragraph",
      content: {
        paragraph_content: [
          text("Inline formula: "),
          {
            type: "equation_inline",
            content: `x_${page}^2 + y_${page}^2 = z_${page}^2`,
          },
          text("."),
        ],
      },
    });
    contentList.push(content);
  }

  const entries: ZipEntryInput[] = [
    {
      data: `${JSON.stringify(contentList)}\n`,
      method: 8,
      name: "stress-result/content_list_v2.json",
    },
  ];
  for (let image = 0; image < imageCount; image += 1) {
    entries.push({
      data: stressPixelPng,
      method: 8,
      name: `stress-result/images/image-${image.toString().padStart(3, "0")}.png`,
    });
  }
  const bytes = buildZip({ entries });
  return Object.freeze({
    bytes,
    metadata: Object.freeze({
      blocks_per_page: blocksPerPage,
      image_count: imageCount,
      pages,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size_bytes: bytes.length,
    }),
  });
}

function argumentsFromCli(arguments_: readonly string[]): {
  readonly options: StressBookOptions;
  readonly output: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!name?.startsWith("--") || !value) {
      throw new Error("Stress fixture arguments must be --name value pairs");
    }
    values.set(name, value);
  }
  const output = values.get("--output");
  if (!output) {
    throw new Error(
      "Usage: build-stress-book --output <zip> [--pages 500] [--blocks 20] [--images 32]",
    );
  }
  for (const name of values.keys()) {
    if (!["--output", "--pages", "--blocks", "--images"].includes(name)) {
      throw new Error(`Unknown argument: ${name}`);
    }
  }
  return {
    options: {
      blocksPerPage: Number.parseInt(values.get("--blocks") ?? "20", 10),
      imageCount: Number.parseInt(values.get("--images") ?? "32", 10),
      pages: Number.parseInt(values.get("--pages") ?? "500", 10),
    },
    output,
  };
}

async function main(): Promise<void> {
  const input = argumentsFromCli(process.argv.slice(2));
  const output = resolve(input.output);
  const generated = buildStressBook(input.options);
  await mkdir(dirname(output), { mode: 0o700, recursive: true });
  await writeFile(output, generated.bytes, { mode: 0o600 });
  await writeFile(
    `${output}.json`,
    `${JSON.stringify(
      {
        ...generated.metadata,
        generator: "mirawind-stress-v1",
        schema_version: 1,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  process.stdout.write(`${JSON.stringify(generated.metadata)}\n`);
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
