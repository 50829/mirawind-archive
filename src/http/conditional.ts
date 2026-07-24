export function ifNoneMatchMatches(
  header: string | null,
  strongEtag: string,
): boolean {
  if (!header) return false;
  return header.split(",").some((candidate) => {
    const value = candidate.trim();
    return value === "*" || value === strongEtag || value === `W/${strongEtag}`;
  });
}
