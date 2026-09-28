import type { ReviewEntry } from "../../core/review";
import type { Workspace } from "../../core/workspaces";

export const count = (n: number, word: string, plural = `${word}s`) =>
  `${n} ${n === 1 ? word : plural}`;
export const shortDateTime = (iso: string) =>
  new Date(iso).toLocaleString([], { dateStyle: "short", timeStyle: "short" });

// How long ago, in the largest whole unit: "3 days ago", "yesterday", "just now".
const relative = new Intl.RelativeTimeFormat([], { numeric: "auto" });
export function ago(iso: string) {
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const [unit, size] of [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3600],
    ["minute", 60],
  ] as const)
    if (Math.abs(s) >= size) return relative.format(Math.round(s / size), unit);
  return "just now";
}

// A workspace by its PR, or its branch until it has one (ADR 0028).
export const workspaceLabel = (w: Workspace) =>
  w.prNumber !== null ? `PR #${w.prNumber}` : `Branch ${w.branch}`;

// The threads on each file, as the Navigator and a view's table of contents show them: yours (notes, questions) and
// the agent's (explanations, findings; only with their view, whose entries the canvas has). Replies, follow-ups and
// answers are part of their thread, so they don't count.
type ThreadKind = "note" | "question" | "explanation" | "finding";
export type ItemCount = Record<ThreadKind, number>;
const threadKinds: ThreadKind[] = ["note", "question", "explanation", "finding"];
export function countItems(entries: ReviewEntry[]): Map<string, ItemCount> {
  const counts = new Map<string, ItemCount>();
  for (const e of entries) {
    // Only what's about the code on screen (ADR 0015): not outdated entries.
    if (!e.path || e.parentId || e.state !== "current" || e.kind === "answer") continue;
    const c = counts.get(e.path) ?? { note: 0, question: 0, explanation: 0, finding: 0 };
    c[e.kind]++;
    counts.set(e.path, c);
  }
  return counts;
}
export const threadCount = (c: ItemCount) => threadKinds.reduce((n, k) => n + c[k], 0);
export const itemsTitle = (c: ItemCount) =>
  threadKinds
    .filter((k) => c[k])
    .map((k) => count(c[k], k))
    .join(", ");
