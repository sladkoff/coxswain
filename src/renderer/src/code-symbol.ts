export type CodeSymbol = { start: number; end: number };

// Syntax highlighters can put several identifiers and their brackets in one token.
export function codeSymbols(text: string): CodeSymbol[] {
  return [...text.matchAll(/[$_\p{ID_Start}][$_\p{ID_Continue}]*/gu)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

// DOM ranges follow the actual glyphs, including wrapped tokens, tabs and page zoom.
export function codeSymbolAtPoint(element: HTMLElement, x: number, y: number) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  const point = (offset: number): [Text, number] | null => {
    let at = 0;
    for (const node of nodes) {
      if (offset <= at + node.length) return [node, offset - at];
      at += node.length;
    }
    return null;
  };
  for (const symbol of codeSymbols(element.textContent ?? "")) {
    const start = point(symbol.start);
    const end = point(symbol.end);
    if (!start || !end) continue;
    const range = document.createRange();
    range.setStart(...start);
    range.setEnd(...end);
    if (
      [...range.getClientRects()].some(
        (rect) => x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom,
      )
    ) {
      return { ...symbol, range };
    }
  }
  return null;
}
