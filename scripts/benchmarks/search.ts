import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  argumentMap,
  boundedInteger,
  hashedInput,
  requiredArgument,
  runConcurrentRequests,
  summarizeLatencies,
  timedFetch,
} from "./http.js";

export interface SearchBenchmarkInput {
  readonly bookKey: string;
  readonly concurrency: number;
  readonly normalQuery: string;
  readonly origin: string;
  readonly requests: number;
  readonly shortQuery: string;
  readonly warmups: number;
}

async function benchmarkQuery(input: {
  readonly bookKey: string;
  readonly concurrency: number;
  readonly expectedScope: "metadata_heading_body" | "metadata_heading_only";
  readonly origin: URL;
  readonly query: string;
  readonly requests: number;
  readonly warmups: number;
}): Promise<Readonly<Record<string, unknown>>> {
  const request = async (index: number): Promise<number> => {
    const url = new URL(
      `/api/books/${encodeURIComponent(input.bookKey)}/search`,
      input.origin,
    );
    url.searchParams.set("benchmark_request", String(index));
    url.searchParams.set("q", input.query);
    return timedFetch({
      expectedContentType: "application/json",
      async inspect(response) {
        if (
          response.headers.get("cache-control") !==
          "public, max-age=0, must-revalidate"
        ) {
          throw new Error("SEARCH_BENCHMARK_CACHE_POLICY_INVALID");
        }
        const body = (await response.clone().json()) as { scope?: unknown };
        if (body.scope !== input.expectedScope) {
          throw new Error("SEARCH_BENCHMARK_SCOPE_INVALID");
        }
      },
      url,
    });
  };
  for (let index = 0; index < input.warmups; index += 1) {
    await request(-index - 1);
  }
  const latencies = await runConcurrentRequests({
    concurrency: input.concurrency,
    request,
    requests: input.requests,
  });
  const summary = summarizeLatencies(latencies);
  return Object.freeze({
    query_code_points: [...input.query].length,
    query_sha256: hashedInput(input.query),
    scope: input.expectedScope,
    status: summary.p95_ms < 1_000 ? "passed" : "failed",
    summary,
    target_p95_ms: 1_000,
  });
}

export async function benchmarkSearch(
  input: SearchBenchmarkInput,
): Promise<Readonly<Record<string, unknown>>> {
  const origin = new URL(input.origin);
  if (!["http:", "https:"].includes(origin.protocol)) {
    throw new Error("SEARCH_BENCHMARK_ORIGIN_INVALID");
  }
  if (!/^(?:[1-9][0-9]*|[a-z0-9]+(?:-[a-z0-9]+)*)$/u.test(input.bookKey)) {
    throw new Error("SEARCH_BENCHMARK_BOOK_KEY_INVALID");
  }
  if (
    [...input.normalQuery].length < 3 ||
    [...input.normalQuery].length > 200 ||
    [...input.shortQuery].length < 1 ||
    [...input.shortQuery].length > 2
  ) {
    throw new Error("SEARCH_BENCHMARK_QUERY_LENGTH_INVALID");
  }
  const [normal, short] = await Promise.all([
    benchmarkQuery({
      bookKey: input.bookKey,
      concurrency: input.concurrency,
      expectedScope: "metadata_heading_body",
      origin,
      query: input.normalQuery,
      requests: input.requests,
      warmups: input.warmups,
    }),
    benchmarkQuery({
      bookKey: input.bookKey,
      concurrency: input.concurrency,
      expectedScope: "metadata_heading_only",
      origin,
      query: input.shortQuery,
      requests: input.requests,
      warmups: input.warmups,
    }),
  ]);
  return Object.freeze({
    book_key: input.bookKey,
    concurrency: input.concurrency,
    normal,
    requests_per_branch: input.requests,
    schema_version: 1,
    short,
    status:
      normal.status === "passed" && short.status === "passed"
        ? "passed"
        : "failed",
    warmups_per_branch: input.warmups,
  });
}

function inputFromArguments(arguments_: readonly string[]): {
  readonly input: SearchBenchmarkInput;
  readonly output: string | null;
} {
  const values = argumentMap(arguments_, [
    "--book-key",
    "--concurrency",
    "--normal-query",
    "--origin",
    "--output",
    "--requests",
    "--short-query",
    "--warmups",
  ]);
  return Object.freeze({
    input: Object.freeze({
      bookKey: requiredArgument(values, "--book-key"),
      concurrency: boundedInteger(
        values.get("--concurrency"),
        8,
        "concurrency",
        1,
        128,
      ),
      normalQuery: requiredArgument(values, "--normal-query"),
      origin: requiredArgument(values, "--origin"),
      requests: boundedInteger(
        values.get("--requests"),
        200,
        "requests",
        20,
        100_000,
      ),
      shortQuery: requiredArgument(values, "--short-query"),
      warmups: boundedInteger(
        values.get("--warmups"),
        20,
        "warmups",
        0,
        10_000,
      ),
    }),
    output: values.get("--output")
      ? resolve(String(values.get("--output")))
      : null,
  });
}

async function main(): Promise<void> {
  const { input, output } = inputFromArguments(process.argv.slice(2));
  const report = await benchmarkSearch(input);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (output) {
    await mkdir(dirname(output), { mode: 0o700, recursive: true });
    await writeFile(output, json, { mode: 0o600 });
  }
  process.stdout.write(json);
  if (report.status !== "passed") process.exitCode = 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "SEARCH_BENCHMARK_FAILED"}\n`,
    );
    process.exitCode = 1;
  });
}
