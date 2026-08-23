import { describe, expect, it } from "vitest";

import { sampleProcessTreeRss } from "@/platform/process/process-tree-rss";

function fakeProc(files: Readonly<Record<string, string>>) {
  return async (path: string): Promise<string> => {
    const value = files[path];
    if (value === undefined)
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return value;
  };
}

describe("Linux process-tree RSS sampling", () => {
  it("sums the root, children and grandchildren", async () => {
    const sample = await sampleProcessTreeRss(10, {
      platform: "linux",
      readText: fakeProc({
        "/proc/10/status": "Name:\troot\nVmRSS:\t100 kB\n",
        "/proc/10/task/10/children": "11 12\n",
        "/proc/11/status": "VmRSS:\t200 kB\n",
        "/proc/11/task/11/children": "13\n",
        "/proc/12/status": "VmRSS:\t300 kB\n",
        "/proc/12/task/12/children": "\n",
        "/proc/13/status": "VmRSS:\t400 kB\n",
        "/proc/13/task/13/children": "\n",
      }),
    });

    expect(sample).toEqual({
      processCount: 4,
      rssBytes: 1_000 * 1_024,
      status: "available",
    });
  });

  it("returns unavailable instead of zero when a process races with sampling", async () => {
    const sample = await sampleProcessTreeRss(10, {
      platform: "linux",
      readText: fakeProc({
        "/proc/10/status": "VmRSS:\t100 kB\n",
        "/proc/10/task/10/children": "11\n",
      }),
    });
    expect(sample).toEqual({
      reason: "process_unavailable",
      status: "unavailable",
    });
  });

  it("bounds traversal and reports non-Linux as unavailable", async () => {
    expect(
      await sampleProcessTreeRss(10, {
        maxProcesses: 2,
        platform: "linux",
        readText: fakeProc({
          "/proc/10/status": "VmRSS:\t100 kB\n",
          "/proc/10/task/10/children": "11 12\n",
        }),
      }),
    ).toEqual({ reason: "process_limit", status: "unavailable" });
    expect(
      await sampleProcessTreeRss(10, {
        platform: "darwin",
        readText: fakeProc({}),
      }),
    ).toEqual({ reason: "unsupported_platform", status: "unavailable" });
  });
});
