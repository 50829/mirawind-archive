export interface PublishPolicyContext {
  readonly bookId: number;
  readonly sourceUpdatedAt: number;
  readonly importId: string;
}

export interface PublishPolicyDecision {
  readonly allowed: boolean;
  readonly code: string;
}

export interface PublishPolicy {
  evaluate(
    context: PublishPolicyContext,
  ): Promise<PublishPolicyDecision> | PublishPolicyDecision;
}

// M1 has no rights-confirmation interaction or fictional confirmation record.
export const m1PublishPolicy: PublishPolicy = Object.freeze({
  evaluate() {
    return Object.freeze({ allowed: true, code: "M1_ALLOW" });
  },
});
