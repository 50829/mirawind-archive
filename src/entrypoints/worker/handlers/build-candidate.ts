import {
  parseBuildCandidateCommand,
  parseCandidateBuildArtifact,
  type BuildCandidateCommand,
  type CandidateBuildArtifact,
  type CandidateBuildStageUpdate,
} from "@/modules/publishing/application/public";
import {
  candidateJobChildProtocolVersion,
  type BuildCandidateProgressMessage,
} from "@/entrypoints/worker/protocol";

export interface CandidateBuildExecutor {
  (input: {
    readonly command: BuildCandidateCommand;
    readonly onStage: (update: CandidateBuildStageUpdate) => void;
    readonly signal?: AbortSignal;
  }): Promise<CandidateBuildArtifact>;
}

export async function handleBuildCandidate(input: {
  readonly command: unknown;
  readonly execute: CandidateBuildExecutor;
  readonly onProgress?: (message: BuildCandidateProgressMessage) => void;
  readonly signal?: AbortSignal;
}): Promise<CandidateBuildArtifact> {
  const command = parseBuildCandidateCommand(input.command);
  const artifact = await input.execute({
    command,
    onStage(update) {
      input.onProgress?.(
        Object.freeze({
          jobId: command.jobId,
          phase: update.phase,
          progress: Object.freeze({
            completed: update.completed,
            processed_bytes: null,
            total: update.total,
            unit: update.unit,
          }),
          protocolVersion: candidateJobChildProtocolVersion,
          type: "progress",
        }),
      );
    },
    ...(input.signal ? { signal: input.signal } : {}),
  });
  return parseCandidateBuildArtifact(artifact, command);
}
