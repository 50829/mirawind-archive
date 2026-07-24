import { validateFallbackPassword } from "../http/authorization/admin-guard.js";

export interface AdminPromptResult {
  readonly confirmation?: boolean;
  readonly displayName?: string;
  readonly email?: string;
  readonly password: string;
}

export interface AdminMutationInput extends AdminPromptResult {
  readonly dataDirectory: string;
}

interface TtyLike {
  readonly isTTY?: boolean;
}

export interface AdminCliDependencies {
  readonly bootstrap: (input: AdminMutationInput) => Promise<void>;
  readonly input?: TtyLike;
  readonly output?: TtyLike;
  readonly prompt?: (
    command: "bootstrap" | "recover",
  ) => Promise<AdminPromptResult>;
  readonly recover: (input: AdminMutationInput) => Promise<void>;
  serviceIsRunning: (dataDirectory: string) => Promise<boolean>;
}

function dataDirectoryFrom(arguments_: readonly string[]): string | null {
  const index = arguments_.indexOf("--data-dir");
  const value = index === -1 ? undefined : arguments_[index + 1];
  return value?.startsWith("/") ? value : null;
}

export async function runAdminCli(
  arguments_: readonly string[],
  dependencies: AdminCliDependencies,
): Promise<number> {
  const [group, command] = arguments_;
  if (group !== "admin" || (command !== "bootstrap" && command !== "recover")) {
    return 2;
  }
  const dataDirectory = dataDirectoryFrom(arguments_);
  if (!dataDirectory) return 2;

  const input = dependencies.input ?? process.stdin;
  const output = dependencies.output ?? process.stderr;
  if (!input.isTTY || !output.isTTY) return 2;
  if (await dependencies.serviceIsRunning(dataDirectory)) return 3;
  if (!dependencies.prompt) return 2;

  let answers: AdminPromptResult;
  try {
    answers = await dependencies.prompt(command);
  } catch {
    return 4;
  }
  if (!validateFallbackPassword(answers.password).valid) return 4;
  if (command === "recover" && answers.confirmation !== true) return 3;
  if (
    command === "bootstrap" &&
    (!answers.email?.trim() || !answers.displayName?.trim())
  ) {
    return 4;
  }

  const mutation =
    command === "bootstrap" ? dependencies.bootstrap : dependencies.recover;
  try {
    await mutation({ ...answers, dataDirectory });
    return 0;
  } catch {
    return 3;
  }
}
