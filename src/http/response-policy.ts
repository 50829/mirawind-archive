export {
  applyResponsePolicy,
  createStrongEtag,
  responsePolicyFor,
  type ResponsePolicy,
  type ResponsePolicyKind,
} from "@/http/cache/policies";
export {
  createSafeHtmlError,
  createSafeJsonError,
  safeErrorInputFromUnknown,
  type SafeErrorInput,
} from "@/http/errors/responses";
export { requireExactOrigin, requireMutationOrigin } from "@/http/origin";

import {
  responsePolicyFor,
  type ResponsePolicyKind,
} from "@/http/cache/policies";

export function cachePolicyFor(kind: ResponsePolicyKind): string {
  return responsePolicyFor(kind).cacheControl;
}
