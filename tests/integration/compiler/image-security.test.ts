import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  inspectRasterImage,
  rasterImageLimits,
} from "@/modules/publishing/core/publication/inspect-image";

function code(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}

async function rejectsWith(
  bytes: Uint8Array,
  filename: string,
  expectedCode: string,
  limits?: { readonly maximumPixels?: number; readonly maximumSide?: number },
): Promise<void> {
  await expect(
    inspectRasterImage({
      bytes,
      filename,
      ...(limits ? { limits } : {}),
    }),
  ).rejects.toSatisfy((error: unknown) => code(error) === expectedCode);
}

async function image(format: "gif" | "jpeg" | "png" | "webp"): Promise<Buffer> {
  const pipeline = sharp({
    create: {
      background: { alpha: 1, b: 30, g: 20, r: 10 },
      channels: 4,
      height: 2,
      width: 2,
    },
  });
  return pipeline[format]().toBuffer();
}

describe("bounded raster image inspection", () => {
  it("locks the approved pixel and side limits", () => {
    expect(rasterImageLimits).toEqual({
      maximumPixels: 100_000_000,
      maximumSide: 32_768,
    });
  });

  it.each(["jpeg", "png", "webp", "gif"] as const)(
    "magic-checks and fully decodes a real single-frame %s",
    async (format) => {
      const result = await inspectRasterImage({
        bytes: await image(format),
        filename: `image.${format === "jpeg" ? "jpg" : format}`,
      });
      expect(result).toMatchObject({ format, height: 2, width: 2 });
    },
  );

  it("rejects extension/magic mismatch and corrupt decode", async () => {
    await rejectsWith(await image("png"), "image.jpg", "IMAGE_FORMAT_MISMATCH");
    await rejectsWith(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
      "image.png",
      "IMAGE_DECODE_FAILED",
    );
  });

  it("rejects pixels and sides before full decode", async () => {
    const bytes = await image("png");
    await rejectsWith(bytes, "image.png", "IMAGE_PIXEL_LIMIT", {
      maximumPixels: 3,
    });
    await rejectsWith(bytes, "image.png", "IMAGE_SIDE_LIMIT", {
      maximumSide: 1,
    });
  });

  it("rejects animated/multipage rasters and SVG vectors", async () => {
    const red = [255, 0, 0, 255];
    const blue = [0, 0, 255, 255];
    const animated = await sharp(
      Buffer.from([
        ...red,
        ...red,
        ...red,
        ...red,
        ...blue,
        ...blue,
        ...blue,
        ...blue,
      ]),
      {
        raw: { channels: 4, height: 4, pageHeight: 2, width: 2 },
      },
    )
      .gif()
      .toBuffer();
    await rejectsWith(animated, "animated.gif", "IMAGE_ANIMATION_UNSUPPORTED");
    await rejectsWith(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>',
      ),
      "image.svg",
      "IMAGE_VECTOR_UNSUPPORTED",
    );
  });
});
