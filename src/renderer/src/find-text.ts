import type { FileDiffMetadata, SelectionSide } from "@pierre/diffs";

// Literal matches with offsets in the original string, including when Unicode case folding changes length.
export function findText(text: string, query: string, matchCase = false): [number, number][] {
  if (!query) return [];
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...text.matchAll(new RegExp(escaped, matchCase ? "gu" : "giu"))].map((m) => [
    m.index,
    m.index + m[0].length,
  ]);
}

// Viewers supply full files (not partial patches). Walk change blocks and fill the unchanged gaps from the new
// side, so split context is counted once and deletion-only blocks retain their place in reading order.
export function diffFindLines(
  diff: FileDiffMetadata,
): { text: string; line: number; side: SelectionSide; context: boolean }[] {
  const rows: { text: string; line: number; side: SelectionSide; context: boolean }[] = [];
  let next = 0;
  const contextUntil = (end: number) => {
    for (; next < end; next++)
      rows.push({
        text: diff.additionLines[next],
        line: next + 1,
        side: "additions",
        context: true,
      });
  };
  for (const hunk of diff.hunks)
    for (const block of hunk.hunkContent) {
      if (block.type !== "change") continue;
      contextUntil(block.additionLineIndex);
      for (let i = 0; i < block.deletions; i++) {
        const at = block.deletionLineIndex + i;
        rows.push({
          text: diff.deletionLines[at],
          line: at + 1,
          side: "deletions",
          context: false,
        });
      }
      for (let i = 0; i < block.additions; i++) {
        const at = block.additionLineIndex + i;
        rows.push({
          text: diff.additionLines[at],
          line: at + 1,
          side: "additions",
          context: false,
        });
      }
      next = Math.max(0, block.additionLineIndex) + block.additions;
    }
  contextUntil(diff.additionLines.length);
  return rows;
}
