import { describe, expect, it } from "vitest";

import { createOpaqueId } from "@/domain/ids";
import {
  dispatchJobCommand,
  type JobCommandRegistry,
} from "@/entrypoints/worker/job-registry";
import {
  isRunJobMessage,
  jobChildProtocolVersion,
} from "@/entrypoints/worker/protocol";

describe("worker command union", () => {
  it("accepts an exact command from the closed union", () => {
    const jobId = createOpaqueId("job");
    const command = {
      attempt: 1,
      createdAtMs: 1,
      jobId,
      kind: "reconcile",
      stagingRelativePath: `staging/${jobId}`,
    };
    const message = {
      input: command,
      protocolVersion: jobChildProtocolVersion,
      type: "run",
    };

    expect(isRunJobMessage(message)).toBe(true);
    expect(
      isRunJobMessage({
        ...message,
        input: { ...command, unexpected: true },
      }),
    ).toBe(false);
  });

  it("dispatches every command through an exhaustive kind registry", () => {
    const handled: string[] = [];
    const handler = (command: { readonly kind: string }) => {
      handled.push(command.kind);
      return command.kind;
    };
    const registry = {
      analyze_import: handler,
      build_candidate: handler,
      prepare_draft: handler,
      reclaim: handler,
      reconcile: handler,
      verify_version: handler,
    } satisfies JobCommandRegistry<string>;
    const jobId = createOpaqueId("job");
    const result = dispatchJobCommand(
      {
        attempt: 1,
        createdAtMs: 1,
        jobId,
        kind: "reconcile",
        stagingRelativePath: `staging/${jobId}`,
      },
      registry,
    );
    expect(result).toBe("reconcile");
    expect(handled).toEqual(["reconcile"]);
  });
});
