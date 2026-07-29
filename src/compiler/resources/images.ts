import { extname } from "node:path";

import sharp, { type Metadata } from "sharp";

import { SafeApplicationError } from "@/domain/errors";

export const rasterImageLimits = Object.freeze({
  maximumPixels: 100_000_000,
  maximumSide: 32_768,
});

export type SupportedRasterFormat = "gif" | "jpeg" | "png" | "webp";

export interface RasterInspection {
  readonly format: SupportedRasterFormat;
  readonly hasAlpha: boolean;
  readonly height: number;
  readonly width: number;
}

type ImageErrorCode =
  | "IMAGE_ANIMATION_UNSUPPORTED"
  | "IMAGE_DECODE_FAILED"
  | "IMAGE_FORMAT_MISMATCH"
  | "IMAGE_FORMAT_UNSUPPORTED"
  | "IMAGE_PIXEL_LIMIT"
  | "IMAGE_SIDE_LIMIT"
  | "IMAGE_VECTOR_UNSUPPORTED";

export class ImageSecurityError extends SafeApplicationError {
  constructor(code: ImageErrorCode, message: string, cause?: unknown) {
    super(code, message, 400, { cause });
    this.name = "ImageSecurityError";
  }
}

function detectedMagic(
  input: Uint8Array,
): SupportedRasterFormat | "svg" | null {
  if (
    input.length >= 8 &&
    input[0] === 0x89 &&
    input[1] === 0x50 &&
    input[2] === 0x4e &&
    input[3] === 0x47 &&
    input[4] === 0x0d &&
    input[5] === 0x0a &&
    input[6] === 0x1a &&
    input[7] === 0x0a
  ) {
    return "png";
  }
  if (
    input.length >= 3 &&
    input[0] === 0xff &&
    input[1] === 0xd8 &&
    input[2] === 0xff
  ) {
    return "jpeg";
  }
  const firstTwelve = Buffer.from(input.subarray(0, 12)).toString("ascii");
  if (firstTwelve.startsWith("GIF87a") || firstTwelve.startsWith("GIF89a")) {
    return "gif";
  }
  if (firstTwelve.startsWith("RIFF") && firstTwelve.slice(8, 12) === "WEBP") {
    return "webp";
  }
  const prefix = new TextDecoder("utf-8", { fatal: false })
    .decode(input.subarray(0, 512))
    .trimStart()
    .toLowerCase();
  if (
    prefix.startsWith("<svg") ||
    (prefix.startsWith("<?xml") && prefix.includes("<svg"))
  ) {
    return "svg";
  }
  return null;
}

function extensionFormat(
  filename: string,
): SupportedRasterFormat | "svg" | null {
  const extension = extname(filename).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "jpeg";
  if (extension === ".png") return "png";
  if (extension === ".webp") return "webp";
  if (extension === ".gif") return "gif";
  if (extension === ".svg" || extension === ".svgz") return "svg";
  return null;
}

export async function inspectRasterImage(input: {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly limits?: {
    readonly maximumPixels?: number;
    readonly maximumSide?: number;
  };
}): Promise<RasterInspection> {
  const maximumPixels =
    input.limits?.maximumPixels ?? rasterImageLimits.maximumPixels;
  const maximumSide =
    input.limits?.maximumSide ?? rasterImageLimits.maximumSide;
  if (
    !Number.isSafeInteger(maximumPixels) ||
    maximumPixels <= 0 ||
    !Number.isSafeInteger(maximumSide) ||
    maximumSide <= 0
  ) {
    throw new TypeError("Image limits must be positive safe integers");
  }

  const magic = detectedMagic(input.bytes);
  const extension = extensionFormat(input.filename);
  if (magic === "svg" || extension === "svg") {
    throw new ImageSecurityError(
      "IMAGE_VECTOR_UNSUPPORTED",
      "SVG images are not supported.",
    );
  }
  if (!magic || !extension) {
    throw new ImageSecurityError(
      "IMAGE_FORMAT_UNSUPPORTED",
      "The image format is not supported.",
    );
  }
  if (magic !== extension) {
    throw new ImageSecurityError(
      "IMAGE_FORMAT_MISMATCH",
      "The image filename and file content formats do not match.",
    );
  }

  const bytes = Buffer.from(input.bytes);
  let metadata: Metadata;
  try {
    metadata = await sharp(bytes, {
      animated: true,
      failOn: "warning",
      limitInputPixels: false,
      sequentialRead: true,
    }).metadata();
  } catch (cause) {
    throw new ImageSecurityError(
      "IMAGE_DECODE_FAILED",
      "The image metadata could not be decoded.",
      cause,
    );
  }
  if (metadata.format !== magic || !metadata.width || !metadata.height) {
    throw new ImageSecurityError(
      "IMAGE_FORMAT_MISMATCH",
      "The decoded image format does not match its signature.",
    );
  }
  if (
    (metadata.pages ?? 1) !== 1 ||
    (metadata.pageHeight !== undefined &&
      metadata.pageHeight !== metadata.height)
  ) {
    throw new ImageSecurityError(
      "IMAGE_ANIMATION_UNSUPPORTED",
      "Animated and multi-page images are not supported.",
    );
  }
  if (metadata.width > maximumSide || metadata.height > maximumSide) {
    throw new ImageSecurityError(
      "IMAGE_SIDE_LIMIT",
      "An image side exceeds the pixel limit.",
    );
  }
  if (metadata.width * metadata.height > maximumPixels) {
    throw new ImageSecurityError(
      "IMAGE_PIXEL_LIMIT",
      "The image exceeds the total pixel limit.",
    );
  }

  try {
    await sharp(bytes, {
      animated: false,
      failOn: "warning",
      limitInputPixels: maximumPixels,
      sequentialRead: true,
    })
      .toColorspace("srgb")
      .raw()
      .toBuffer();
  } catch (cause) {
    throw new ImageSecurityError(
      "IMAGE_DECODE_FAILED",
      "The image pixels could not be decoded.",
      cause,
    );
  }
  return Object.freeze({
    format: magic,
    hasAlpha: Boolean(metadata.hasAlpha),
    height: metadata.height,
    width: metadata.width,
  });
}
