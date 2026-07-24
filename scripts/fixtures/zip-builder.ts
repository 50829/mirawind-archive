import { deflateRawSync } from "node:zlib";

export interface ZipEntryInput {
  readonly centralName?: string;
  readonly data?: string | Uint8Array;
  readonly declaredCompressedSize?: number;
  readonly declaredUncompressedSize?: number;
  readonly externalAttributes?: number;
  readonly flags?: number;
  readonly method?: number;
  readonly name: string;
}

export interface ZipBuildOptions {
  readonly centralDirectoryDisk?: number;
  readonly entries: readonly ZipEntryInput[];
  readonly eocdDisk?: number;
}

const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

export function crc32(input: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function uint32(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${label} must fit in an unsigned ZIP32 field`);
  }
  return value;
}

function bytes(value: string | Uint8Array | undefined): Buffer {
  if (typeof value === "string") return Buffer.from(value, "utf8");
  return value ? Buffer.from(value) : Buffer.alloc(0);
}

export function buildZip(options: ZipBuildOptions): Buffer {
  if (options.entries.length > 0xffff) {
    throw new Error(
      "The deterministic test builder supports at most 65,535 entries",
    );
  }
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of options.entries) {
    const source = bytes(entry.data);
    const method = entry.method ?? 0;
    const compressed =
      method === 8 ? deflateRawSync(source, { level: 9 }) : source;
    const name = Buffer.from(entry.name, "utf8");
    const centralName = Buffer.from(entry.centralName ?? entry.name, "utf8");
    const flags = (entry.flags ?? 0) | 0x0800;
    const declaredCompressedSize = uint32(
      entry.declaredCompressedSize ?? compressed.length,
      "declaredCompressedSize",
    );
    const declaredUncompressedSize = uint32(
      entry.declaredUncompressedSize ?? source.length,
      "declaredUncompressedSize",
    );
    const checksum = crc32(source);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(flags, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(declaredCompressedSize, 18);
    localHeader.writeUInt32LE(declaredUncompressedSize, 22);
    localHeader.writeUInt16LE(name.length, 26);
    const local = Buffer.concat([localHeader, name, compressed]);
    localParts.push(local);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(flags, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(declaredCompressedSize, 20);
    centralHeader.writeUInt32LE(declaredUncompressedSize, 24);
    centralHeader.writeUInt16LE(centralName.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(
      uint32(entry.externalAttributes ?? 0, "externalAttributes"),
      38,
    );
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(Buffer.concat([centralHeader, centralName]));
    localOffset += local.length;
  }

  const localData = Buffer.concat(localParts);
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(options.eocdDisk ?? 0, 4);
  end.writeUInt16LE(options.centralDirectoryDisk ?? 0, 6);
  end.writeUInt16LE(options.entries.length, 8);
  end.writeUInt16LE(options.entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localData.length, 16);
  return Buffer.concat([localData, centralDirectory, end]);
}
