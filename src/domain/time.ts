export type Clock = () => number;

export const systemClock: Clock = () => Date.now();

export function toIsoDateTime(unixMilliseconds: number): string {
  if (!Number.isSafeInteger(unixMilliseconds) || unixMilliseconds < 0) {
    throw new RangeError(
      "unixMilliseconds must be a non-negative safe integer",
    );
  }
  return new Date(unixMilliseconds).toISOString();
}
