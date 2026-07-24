import pino, { type DestinationStream, type Logger } from "pino";

const redactPaths = [
  "authorization",
  "cookie",
  "markdown",
  "password",
  "rawArchivePath",
  "req.headers.authorization",
  "req.headers.cookie",
  "request.headers.authorization",
  "request.headers.cookie",
  "*.authorization",
  "*.cookie",
  "*.markdown",
  "*.password",
  "*.rawArchivePath",
];

export interface LoggerOptions {
  readonly bindings?: Readonly<{
    attempt?: number;
    bookId?: number;
    jobId?: string;
    phase?: string;
    requestId?: string;
    versionId?: string;
  }>;
  readonly destination?: DestinationStream;
  readonly service: "web" | "worker" | "child" | "cli" | "test";
}

export function createLogger(options: LoggerOptions): Logger {
  return pino(
    {
      base: { service: options.service, ...options.bindings },
      level: process.env.LOG_LEVEL ?? "info",
      redact: {
        censor: "[REDACTED]",
        paths: redactPaths,
      },
    },
    options.destination,
  );
}
