import {
  analyzeImportHandler,
  buildCandidateHandler,
  prepareDraftHandler,
} from "@/composition/worker-child/handlers/publishing";
import {
  purgeBookHandler,
  reclaimVersionsHandler,
  reconcileHandler,
  verifyVersionHandler,
} from "@/composition/worker-child/handlers/maintenance";
import type {
  WorkerChildContext,
  WorkerChildOutcome,
} from "@/composition/worker-child/types";
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
    purge_book: (input) => purgeBookHandler(input, context),
    reclaim_versions: (input) => reclaimVersionsHandler(input, context),
    reconcile: (input) => reconcileHandler(input, context),
    verify_version: (input) => verifyVersionHandler(input, context),
  } satisfies JobCommandRegistry<Promise<WorkerChildOutcome>>;
  return Promise.resolve(dispatchJobCommand(command, registry));
}
