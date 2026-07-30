import {
  parseBuildCandidateCommand,
  parseCandidateBuildArtifact,
  type BuildCandidateCommand,
  type CandidateBuildArtifact,
} from "@/modules/publishing/application/commands/build-candidate";

export interface CandidateRegistrationPort<Result> {
  register(input: {
    readonly artifact: CandidateBuildArtifact;
    readonly command: BuildCandidateCommand;
    readonly leaseOwner: string;
    readonly nowMs: number;
  }): Promise<Result>;
}

export async function finalizeCandidate<Result>(input: {
  readonly artifact: unknown;
  readonly command: unknown;
  readonly leaseOwner: string;
  readonly nowMs: number;
  readonly registration: CandidateRegistrationPort<Result>;
}): Promise<Result> {
  const command = parseBuildCandidateCommand(input.command);
  const artifact = parseCandidateBuildArtifact(input.artifact, command);
  return input.registration.register({
    artifact,
    command,
    leaseOwner: input.leaseOwner,
    nowMs: input.nowMs,
  });
}
