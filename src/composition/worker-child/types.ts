import type {
  JobPhase,
  JobProgress,
} from "@/modules/publishing/application/public";
import type { JobResultMessage } from "@/entrypoints/worker/protocol";

export type WorkerChildResultData = Readonly<
  Record<string, string | number | boolean | null>
>;

export type WorkerChildOutcome =
  | Readonly<{ ok: true; result?: WorkerChildResultData }>
  | Readonly<{
      ok: false;
      safeErrorClass: NonNullable<JobResultMessage["safeErrorClass"]>;
      safeErrorCode: string;
    }>;

export interface WorkerChildContext {
  readonly reportProgress: (phase: JobPhase, progress: JobProgress) => void;
  readonly root: string;
  readonly signal: AbortSignal;
}

export function stepProgress(completed: number, total: number): JobProgress {
  return Object.freeze({
    completed,
    processed_bytes: null,
    total,
    unit: "steps",
  });
}
