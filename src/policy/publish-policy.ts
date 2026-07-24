export interface PublishPolicyContext {
  readonly bookId: number;
  readonly configRevision: number;
  readonly sourceId: string;
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

/**
 * M1 intentionally has no rights-confirmation interaction. This allow policy
 * preserves the extension boundary without creating a fictional confirmation
 * field or audit record.
 */
export const m1PublishPolicy: PublishPolicy = Object.freeze({
  evaluate() {
    return Object.freeze({ allowed: true, code: "M1_ALLOW" });
  },
});
