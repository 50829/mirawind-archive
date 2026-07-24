export interface TestHttpRequestOptions extends RequestInit {
  readonly timeoutMs?: number;
}

export interface ExpectedResponsePolicy {
  readonly cacheControl: string;
  readonly robotsTag?: string | null;
  readonly status: number;
}

export async function fetchWithTimeout(
  input: string | URL,
  options: TestHttpRequestOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;
  const { timeoutMs: ignored, ...requestOptions } = options;
  void ignored;
  return fetch(input, {
    ...requestOptions,
    redirect: requestOptions.redirect ?? "manual",
    signal,
  });
}

export async function readJsonBody<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type");
  if (!contentType?.toLowerCase().includes("application/json")) {
    throw new Error(
      `Expected a JSON response, received ${contentType ?? "no content type"}`,
    );
  }
  return (await response.json()) as T;
}

export function assertResponsePolicy(
  response: Response,
  expected: ExpectedResponsePolicy,
): void {
  const actual = {
    cacheControl: response.headers.get("cache-control"),
    robotsTag: response.headers.get("x-robots-tag"),
    status: response.status,
  };
  if (
    actual.status !== expected.status ||
    actual.cacheControl !== expected.cacheControl ||
    (expected.robotsTag !== undefined &&
      actual.robotsTag !== expected.robotsTag)
  ) {
    throw new Error(
      `Unexpected response policy: ${JSON.stringify(actual)}; expected ${JSON.stringify(expected)}`,
    );
  }
}

export async function waitForHttp(
  url: string | URL,
  options: {
    readonly intervalMs?: number;
    readonly timeoutMs?: number;
  } = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await fetchWithTimeout(url, {
        timeoutMs: Math.min(1_000, Math.max(1, deadline - Date.now())),
      });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) =>
        setTimeout(resolve, options.intervalMs ?? 50),
      );
    }
  }
  throw new Error(`HTTP endpoint did not become ready within ${timeoutMs} ms`, {
    cause: lastError,
  });
}
