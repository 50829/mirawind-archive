import type { FrozenJobInput } from "@/entrypoints/worker/protocol";

type CommandOf<Kind extends FrozenJobInput["kind"]> = Extract<
  FrozenJobInput,
  { readonly kind: Kind }
>;

export type JobCommandRegistry<Result> = Readonly<{
  [Kind in FrozenJobInput["kind"]]: (
    command: CommandOf<Kind>,
  ) => Promise<Result> | Result;
}>;

export function dispatchJobCommand<Result>(
  command: FrozenJobInput,
  registry: JobCommandRegistry<Result>,
): Promise<Result> | Result {
  switch (command.kind) {
    case "analyze_import":
      return registry.analyze_import(command);
    case "build_preview":
      return registry.build_preview(command);
    case "build_publish":
      return registry.build_publish(command);
    case "prepare_draft":
      return registry.prepare_draft(command);
    case "reclaim":
      return registry.reclaim(command);
    case "reconcile":
      return registry.reconcile(command);
    case "verify_version":
      return registry.verify_version(command);
  }
}
