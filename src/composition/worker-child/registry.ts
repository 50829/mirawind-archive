import {
  analyzeImportHandler,
  buildCandidateHandler,
  prepareDraftHandler,
  saveDraftHandler,
} from "./handlers/publishing";
import { purgeBookHandler } from "./handlers/purge-book";
import type { WorkerChildContext, WorkerChildOutcome } from "./job-handler";
import {
  dispatchJobCommand,
  type JobCommandRegistry,
} from "@/entrypoints/worker/job-registry";
import type { FrozenJobInput } from "@/entrypoints/worker/protocol";

export function executeWorkerChildCommand(
  command: FrozenJobInput,
  context: WorkerChildContext,
): Promise<WorkerChildOutcome> {
  const registry = {
    analyze_import: (input) => analyzeImportHandler(input, context),
    build_candidate: (input) => buildCandidateHandler(input, context),
    prepare_draft: (input) => prepareDraftHandler(input, context),
    save_draft: (input) => saveDraftHandler(input, context),
    purge_book: (input) => purgeBookHandler(input, context),
  } satisfies JobCommandRegistry<Promise<WorkerChildOutcome>>;
  return Promise.resolve(dispatchJobCommand(command, registry));
}
