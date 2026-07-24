export class SafeApplicationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SafeApplicationError";
  }
}

export function safeErrorCode(error: unknown): string {
  return error instanceof SafeApplicationError
    ? error.code
    : "INTERNAL_SERVER_ERROR";
}

export interface SafeDiagnostic {
  readonly blockId?: string;
  readonly code: string;
  readonly message: string;
}

export function createSafeDiagnostic(input: SafeDiagnostic): SafeDiagnostic {
  if (!/^[A-Z][A-Z0-9_]{2,79}$/.test(input.code)) {
    throw new TypeError("Diagnostic code is invalid");
  }
  return Object.freeze({
    ...(input.blockId ? { blockId: input.blockId.slice(0, 100) } : {}),
    code: input.code,
    message: input.message.slice(0, 500),
  });
}
