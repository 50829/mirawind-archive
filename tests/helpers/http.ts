export interface TestHttpRequestOptions extends RequestInit {
  readonly timeoutMs?: number;
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
