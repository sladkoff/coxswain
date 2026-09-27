// How well `query` matches `text`, higher is better; null if its letters aren't all in `text` in order. Case is
// ignored. A substring beats letters in order: earlier, in the last path segment, or at a word's start is better.
// Letters in order: fewer gaps is better. Shorter texts win ties.
export function fuzzyScore(text: string, query: string): number | null {
  const t = text.toLowerCase();
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const tie = -t.length / 1000;
  const at = t.indexOf(q);
  if (at >= 0) {
    const inName = at > t.lastIndexOf("/") ? 2000 : 0;
    const wordStart = at === 0 || /[\s/._-]/.test(t[at - 1]) ? 3000 : 0;
    return 10000 + inName + wordStart - at + tie;
  }
  let i = 0;
  let gaps = 0;
  let last = -1;
  for (let j = 0; j < t.length && i < q.length; j++) {
    if (t[j] !== q[i]) continue;
    if (last >= 0 && j > last + 1) gaps++;
    last = j;
    i++;
  }
  return i === q.length ? -gaps + tie : null;
}

// The items matching `query`, best first; the first `limit` of them.
// ponytail: scores every item on each keystroke; fine for a worktree's paths, move off the main thread if huge repos lag.
export function fuzzyFilter<T>(items: T[], query: string, text: (item: T) => string, limit = 50) {
  return items
    .flatMap((item) => {
      const score = fuzzyScore(text(item), query);
      return score === null ? [] : [{ item, score }];
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((m) => m.item);
}
