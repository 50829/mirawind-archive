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
