import { isAbsolute, resolve } from "node:path";

export interface EnvironmentConfig {
  readonly allowedHosts: readonly string[];
  readonly authSecret: string;
  readonly dataDirectory: string;
  readonly passkeyRpId: string;
  readonly publicOrigin: string;
}

export class EnvironmentValidationError extends Error {
  readonly code = "INVALID_ENVIRONMENT";

  constructor(message: string) {
    super(message);
    this.name = "EnvironmentValidationError";
  }
}

function required(
  input: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = input[name]?.trim();
  if (!value) {
    throw new EnvironmentValidationError(`${name} is required`);
  }
  return value;
}

function isLocalhost(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}

function validateSecret(secret: string): void {
  if (Buffer.byteLength(secret, "utf8") < 32 || new Set(secret).size < 4) {
    throw new EnvironmentValidationError(
      "MIRAWIND_AUTH_SECRET must contain at least 32 high-entropy bytes",
    );
  }
}

export function parseEnvironment(
  input: Readonly<Record<string, string | undefined>>,
  options: { readonly mode: "development" | "production" | "test" },
): EnvironmentConfig {
  const dataDirectory = required(input, "MIRAWIND_DATA_DIR");
  if (!isAbsolute(dataDirectory) || resolve(dataDirectory) === "/") {
    throw new EnvironmentValidationError(
      "MIRAWIND_DATA_DIR must be a non-root absolute path",
    );
  }

  const publicOriginValue = required(input, "MIRAWIND_PUBLIC_ORIGIN");
  let publicOrigin: URL;
  try {
    publicOrigin = new URL(publicOriginValue);
  } catch {
    throw new EnvironmentValidationError(
      "MIRAWIND_PUBLIC_ORIGIN must be a URL",
    );
  }

  if (
    publicOrigin.username ||
    publicOrigin.password ||
    publicOrigin.pathname !== "/" ||
    publicOrigin.search ||
    publicOrigin.hash
  ) {
    throw new EnvironmentValidationError(
      "MIRAWIND_PUBLIC_ORIGIN must contain only scheme, host, and optional port",
    );
  }
  if (
    publicOrigin.protocol !== "https:" &&
    !(
      options.mode !== "production" &&
      publicOrigin.protocol === "http:" &&
      isLocalhost(publicOrigin.hostname)
    )
  ) {
    throw new EnvironmentValidationError(
      "MIRAWIND_PUBLIC_ORIGIN must use HTTPS outside localhost development",
    );
  }

  const passkeyRpId = required(input, "MIRAWIND_PASSKEY_RP_ID");
  if (passkeyRpId !== publicOrigin.hostname) {
    throw new EnvironmentValidationError(
      "MIRAWIND_PASSKEY_RP_ID must exactly match the public origin hostname",
    );
  }

  const allowedHosts = required(input, "MIRAWIND_ALLOWED_HOSTS")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (
    allowedHosts.length === 0 ||
    !allowedHosts.includes(publicOrigin.hostname.toLowerCase())
  ) {
    throw new EnvironmentValidationError(
      "MIRAWIND_ALLOWED_HOSTS must contain the public origin hostname",
    );
  }

  const authSecret = required(input, "MIRAWIND_AUTH_SECRET");
  validateSecret(authSecret);

  return Object.freeze({
    allowedHosts: Object.freeze([...new Set(allowedHosts)]),
    authSecret,
    dataDirectory: resolve(dataDirectory),
    passkeyRpId,
    publicOrigin: publicOrigin.origin,
  });
}
