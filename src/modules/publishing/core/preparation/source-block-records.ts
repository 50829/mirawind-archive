import type { NormalizedDocument } from "./document-model";

export interface SourceBlockRecord {
  readonly block_id: string;
  readonly end_offset: number;
  readonly kind: string;
  readonly start_offset: number;
  readonly text_fingerprint: string;
}

export function createSourceBlockRecords(
  document: NormalizedDocument,
): readonly SourceBlockRecord[] {
  return Object.freeze(
    document.blocks.map((block) => {
      if (!block.blockId || !block.position || !block.textFingerprint) {
        throw new Error("SOURCE_BLOCK_IDENTITY_MISSING");
      }
      return Object.freeze({
        block_id: block.blockId,
        end_offset: block.position.end.offset,
        kind: block.type,
        start_offset: block.position.start.offset,
        text_fingerprint: block.textFingerprint,
      });
    }),
  );
}
