export interface ComboOption { value: string; label: string; /** secondary text that is searched too (a code, a unit...) and shown dimmed */ hint?: string; row?: any }

/** Words of a search text, lower-cased. */
export const tokens = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);

/**
 * Options that contain every typed word (in the label or the hint, any order, any case).
 * Options whose label starts with the first word come first, then the rest in their original order.
 */
export function filterOptions<T extends ComboOption>(options: T[], query: string): T[] {
  const words = tokens(query);
  if (!words.length) return options;
  const hit = (o: T) => { const hay = `${o.label} ${o.hint ?? ''}`.toLowerCase(); return words.every((w) => hay.includes(w)); };
  const matched = options.filter(hit);
  const starts = (o: T) => o.label.toLowerCase().startsWith(words[0]);
  return [...matched.filter(starts), ...matched.filter((o) => !starts(o))];
}

/** Index of the next / previous option, wrapping around; -1 when there is nothing to move to. */
export function moveIndex(current: number, delta: 1 | -1, count: number): number {
  if (count <= 0) return -1;
  if (current < 0) return delta === 1 ? 0 : count - 1;
  return (current + delta + count) % count;
}

/** Splits a label around the first occurrence of any typed word, for highlighting. */
export function splitMatch(label: string, query: string): { before: string; match: string; after: string } | null {
  const lower = label.toLowerCase();
  for (const w of tokens(query)) {
    const i = lower.indexOf(w);
    if (i >= 0) return { before: label.slice(0, i), match: label.slice(i, i + w.length), after: label.slice(i + w.length) };
  }
  return null;
}
