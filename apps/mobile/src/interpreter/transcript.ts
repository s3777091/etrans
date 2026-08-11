export function appendTranscript(
  current: string,
  incoming: string,
  language: "zh" | "vi" | "en",
): string {
  const next = incoming.trim();
  if (!next) return current;
  if (!current) return next;
  if (next.startsWith(current)) return next;
  if (current.endsWith(next)) return current;

  const needsSpace =
    language !== "zh" &&
    /[\p{L}\p{N}]$/u.test(current) &&
    /^[\p{L}\p{N}]/u.test(next);
  return `${current}${needsSpace ? " " : ""}${next}`;
}
