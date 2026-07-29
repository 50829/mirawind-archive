export class SourceTextIndex {
  readonly byteLength: number;
  readonly sourceLength: number;

  readonly #byteOffsets: Uint32Array;

  constructor(source: string) {
    this.sourceLength = source.length;
    this.#byteOffsets = new Uint32Array(source.length + 1);

    let byteOffset = 0;
    for (
      let sourceOffset = 0;
      sourceOffset < source.length;
      sourceOffset += 1
    ) {
      const codeUnit = source.charCodeAt(sourceOffset);
      if (
        codeUnit >= 0xd800 &&
        codeUnit <= 0xdbff &&
        sourceOffset + 1 < source.length
      ) {
        const nextCodeUnit = source.charCodeAt(sourceOffset + 1);
        if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
          this.#byteOffsets[sourceOffset + 1] = byteOffset + 3;
          byteOffset += 4;
          sourceOffset += 1;
          this.#byteOffsets[sourceOffset + 1] = byteOffset;
          continue;
        }
      }

      byteOffset += codeUnit <= 0x7f ? 1 : codeUnit <= 0x7ff ? 2 : 3;
      this.#byteOffsets[sourceOffset + 1] = byteOffset;
    }
    this.byteLength = byteOffset;
    Object.freeze(this);
  }

  byteOffsetAt(sourceOffset: number): number {
    if (
      !Number.isSafeInteger(sourceOffset) ||
      sourceOffset < 0 ||
      sourceOffset > this.sourceLength
    ) {
      throw new RangeError("Source offset is outside the Markdown");
    }
    return this.#byteOffsets[sourceOffset] ?? 0;
  }
}
