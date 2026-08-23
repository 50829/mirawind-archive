export {
  applyResponsePolicy,
  createStrongEtag,
  responsePolicyFor,
  type ResponsePolicy,
  type ResponsePolicyKind,
} from "./cache/policies";
export {
  createSafeHtmlError,
  createSafeJsonError,
  safeErrorInputFromUnknown,
  type SafeErrorInput,
} from "./errors/responses";
export { requireExactOrigin, requireMutationOrigin } from "./origin";

import { responsePolicyFor, type ResponsePolicyKind } from "./cache/policies";

export function cachePolicyFor(kind: ResponsePolicyKind): string {
  return responsePolicyFor(kind).cacheControl;
}
