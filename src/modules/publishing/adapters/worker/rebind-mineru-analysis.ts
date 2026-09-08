import type { SafeDiagnostic } from "@/domain/errors";
import type { organizeMineruBook } from "./organize-mineru-book";

export type MineruBookAnalysis = Awaited<
  ReturnType<typeof organizeMineruBook>
>["analysis"];

export function rebindMineruAnalysis(
  analysis: MineruBookAnalysis,
  ids: ReadonlyMap<string, string>,
): MineruBookAnalysis {
  const blockId = (id: string) => ids.get(id) ?? id;
  function diagnostic(value: SafeDiagnostic): SafeDiagnostic {
    return {
      ...value,
      ...(value.blockId ? { blockId: blockId(value.blockId) } : {}),
      ...(value.location?.blockId
        ? {
            location: {
              ...value.location,
              blockId: blockId(value.location.blockId),
            },
          }
        : {}),
      ...(value.targets
        ? {
            targets: value.targets.map((target) =>
              target.kind === "reprocess_verbatim"
                ? target
                : { ...target, blockId: blockId(target.blockId) },
            ),
          }
        : {}),
    };
  }
  return {
    ...analysis,
    origins: analysis.origins.map((origin) => ({
      ...origin,
      block_id: blockId(origin.block_id),
    })),
    removed_block_ids: analysis.removed_block_ids.map(blockId),
    diagnostics: analysis.diagnostics.map(diagnostic),
    printed_contents: analysis.printed_contents.map((candidate) => ({
      ...candidate,
      diagnostics: candidate.diagnostics.map((value) => ({
        ...value,
        ...(value.blockId ? { blockId: blockId(value.blockId) } : {}),
      })),
      logicalEntries: candidate.logicalEntries.map((entry) => ({
        ...entry,
        ...(entry.bodyHeadingBlockId
          ? { bodyHeadingBlockId: blockId(entry.bodyHeadingBlockId) }
          : {}),
      })),
      ...(candidate.proposedRegion
        ? {
            proposedRegion: {
              ...candidate.proposedRegion,
              block_ids: candidate.proposedRegion.block_ids.map(blockId),
            },
          }
        : {}),
    })),
  };
}
