export const administratorSessionPolicy = Object.freeze({
  expiresIn: 90 * 24 * 60 * 60,
  freshAge: 5 * 60,
  updateAge: 7 * 24 * 60 * 60,
});
export const localDevelopmentSessionId = "local-development";

export interface RequestSession {
  readonly authenticatedAtMs: number;
  readonly expiresAtMs: number;
  readonly sessionId: string;
  readonly user: {
    readonly email: string;
    readonly id: string;
    readonly name: string;
  };
}
