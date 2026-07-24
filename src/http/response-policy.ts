export {
  applyResponsePolicy,
  createStrongEtag,
  responsePolicyFor,
  type ResponsePolicy,
  type ResponsePolicyKind,
} from "./cache/policies.js";
export {
  createSafeHtmlError,
  createSafeJsonError,
  safeErrorInputFromUnknown,
  type SafeErrorInput,
} from "./errors/responses.js";
export { requireExactOrigin, requireMutationOrigin } from "./origin.js";

import {
  responsePolicyFor,
  type ResponsePolicyKind,
} from "./cache/policies.js";

export function cachePolicyFor(kind: ResponsePolicyKind): string {
  return responsePolicyFor(kind).cacheControl;
}
