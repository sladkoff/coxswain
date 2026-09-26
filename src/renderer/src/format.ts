import type { ReviewEntry } from "../../core/review";

export const count = (n: number, word: string, plural = `${word}s`) =>
  `${n} ${n === 1 ? word : plural}`;
export const shortDateTime = (iso: string) =>
  new Date(iso).toLocaleString([], { dateStyle: "short", timeStyle: "short" });

// The workspace's notes and questions on each file, as the Navigator shows them.
// Replies, follow-ups and answers are part of their thread, so they don't count.
export type ItemCount = { notes: number; questions: number };
export function countItems(entries: ReviewEntry[]): Map<string, ItemCount> {
  const counts = new Map<string, ItemCount>();
  for (const e of entries) {
    // Only what's about the code on screen (ADR 0015): not outdated entries.
    if (
      !e.path ||
      e.parentId ||
      e.state !== "current" ||
      (e.kind !== "note" && e.kind !== "question")
    )
      continue;
    const c = counts.get(e.path) ?? { notes: 0, questions: 0 };
    if (e.kind === "note") c.notes++;
    if (e.kind === "question") c.questions++;
    counts.set(e.path, c);
  }
  return counts;
}
export const itemsTitle = (c: ItemCount) =>
  [c.notes && count(c.notes, "note"), c.questions && count(c.questions, "question")]
    .filter(Boolean)
    .join(", ");
