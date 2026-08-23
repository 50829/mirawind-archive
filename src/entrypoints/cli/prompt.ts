import { confirm, input, password } from "@inquirer/prompts";

import type { AdminPromptResult } from "./admin-cli";

async function confirmedPassword(): Promise<string> {
  const first = await password({
    mask: "*",
    message: "Fallback password (16–128 characters)",
  });
  const second = await password({
    mask: "*",
    message: "Confirm fallback password",
  });
  if (first !== second) throw new Error("PASSWORD_CONFIRMATION_MISMATCH");
  return first;
}

export async function promptForAdministrator(
  command: "bootstrap" | "recover",
): Promise<AdminPromptResult> {
  if (command === "recover") {
    const confirmation = await confirm({
      default: false,
      message:
        "Revoke all sessions and delete every Passkey for the sole administrator?",
    });
    if (!confirmation) return { confirmation: false, password: "" };
    return {
      confirmation: true,
      password: await confirmedPassword(),
    };
  }

  const email = await input({
    message: "Administrator email",
    validate(value) {
      return value.includes("@") || "Enter a valid email address";
    },
  });
  const displayName = await input({
    message: "Administrator display name",
    validate(value) {
      return value.trim().length > 0 || "Display name is required";
    },
  });
  return {
    displayName: displayName.trim(),
    email: email.trim().toLowerCase(),
    password: await confirmedPassword(),
  };
}
