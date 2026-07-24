import { createHash } from "node:crypto";

export interface LatencySummary {
  readonly count: number;
  readonly maximum_ms: number;
  readonly mean_ms: number;
  readonly minimum_ms: number;
  readonly p50_ms: number;
  readonly p95_ms: number;
  readonly p99_ms: number;
}

export function boundedInteger(
  value: string | undefined,
  fallback: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${label} must be an integer from ${minimum} to ${maximum}`,
    );
  }
  return parsed;
}

export function argumentMap(
  arguments_: readonly string[],
  allowed: readonly string[],
): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!name?.startsWith("--") || !value) {
      throw new Error("Benchmark arguments must be --name value pairs");
    }
    if (!allowed.includes(name)) throw new Error(`Unknown argument: ${name}`);
    if (values.has(name)) throw new Error(`Duplicate argument: ${name}`);
    values.set(name, value);
  }
  return values;
}

export function requiredArgument(
  values: ReadonlyMap<string, string>,
  name: string,
): string {
  const value = values.get(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function rounded(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) throw new Error("LATENCY_SAMPLE_EMPTY");
  const rank = Math.max(1, Math.ceil(sorted.length * fraction));
  const value = sorted[Math.min(sorted.length - 1, rank - 1)];
  if (value === undefined) throw new Error("LATENCY_PERCENTILE_MISSING");
  return rounded(value);
}

export function summarizeLatencies(values: readonly number[]): LatencySummary {
  if (values.length === 0 || values.some((value) => value < 0)) {
    throw new Error("LATENCY_SAMPLE_INVALID");
  }
  const sorted = [...values].sort((left, right) => left - right);
  return Object.freeze({
    count: sorted.length,
    maximum_ms: rounded(sorted.at(-1) as number),
    mean_ms: rounded(
      sorted.reduce((total, value) => total + value, 0) / sorted.length,
    ),
    minimum_ms: rounded(sorted[0] as number),
    p50_ms: percentile(sorted, 0.5),
    p95_ms: percentile(sorted, 0.95),
    p99_ms: percentile(sorted, 0.99),
  });
}

export async function runConcurrentRequests(input: {
  readonly concurrency: number;
  readonly request: (index: number) => Promise<number>;
  readonly requests: number;
}): Promise<readonly number[]> {
  const latencies = new Array<number>(input.requests);
  let nextIndex = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(input.concurrency, input.requests) },
      async () => {
        while (nextIndex < input.requests) {
          const index = nextIndex;
          nextIndex += 1;
          latencies[index] = await input.request(index);
        }
      },
    ),
  );
  return Object.freeze(latencies);
}

export function hashedInput(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export async function timedFetch(input: {
  readonly expectedContentType: string;
  readonly inspect?: (response: Response) => Promise<void> | void;
  readonly url: URL;
}): Promise<number> {
  const startedAt = performance.now();
  const response = await fetch(input.url, {
    headers: {
      "Cache-Control": "no-cache",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  await input.inspect?.(response);
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error(`HTTP_BENCHMARK_STATUS_${response.status}`);
  }
  if (
    !response.headers
      .get("content-type")
      ?.toLowerCase()
      .includes(input.expectedContentType)
  ) {
    await response.body?.cancel();
    throw new Error("HTTP_BENCHMARK_CONTENT_TYPE_INVALID");
  }
  await response.arrayBuffer();
  return performance.now() - startedAt;
}
