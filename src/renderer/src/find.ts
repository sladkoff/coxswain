import { findText } from "./find-text";

export type FindPane = "canvas" | "chat";
export type FindMatch = {
  key: string;
  file?: string;
  range: () => Range | null;
  reveal: () => void;
};
export type FindTarget = {
  pane: FindPane;
  label: string;
  element: () => HTMLElement | null;
  search: (query: string, matchCase: boolean) => FindMatch[];
  prepare?: () => Promise<void>;
  members?: () => FindTarget[];
  clear?: () => void;
};

type FindState = {
  target: FindTarget | null;
  query: string;
  matchCase: boolean;
  matches: FindMatch[];
  index: number;
  focus: number;
  searching: boolean;
  error: string | null;
};
let state: FindState = {
  target: null,
  query: "",
  matchCase: false,
  matches: [],
  index: 0,
  focus: 0,
  searching: false,
  error: null,
};
const queries: Record<FindPane, string> = { canvas: "", chat: "" };
const targets = new Set<FindTarget>();
const listeners = new Set<() => void>();
let lastPane: FindPane = "canvas";
let returnFocus: HTMLElement | null = null;
let pendingFrame = 0;
let pendingReveal = false;
let request = 0;
const members = () => state.target?.members?.() ?? (state.target ? [state.target] : []);

export const findSnapshot = () => state;
export function subscribeFind(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function publish(change: Partial<FindState>) {
  state = { ...state, ...change };
  listeners.forEach((listener) => listener());
}

// The last-used pane survives opening the native menu or command palette.
export function activateFindPane(pane: FindPane) {
  lastPane = pane;
}
function available(target: FindTarget) {
  // Off-screen files belong to the search too; only display-hidden or unmounted viewers are excluded.
  return !!target.element()?.checkVisibility();
}
function canvasTargets() {
  return [...targets]
    .filter((t) => t.pane === "canvas" && available(t))
    .sort((a, b) =>
      a.element()!.compareDocumentPosition(b.element()!) & Node.DOCUMENT_POSITION_FOLLOWING
        ? -1
        : 1,
    );
}
export function registerFindTarget(target: FindTarget) {
  targets.add(target);
  if (state.target?.members && target.pane === "canvas") void updateMatches(false);
  return () => {
    targets.delete(target);
    if (state.target === target) closeFind(false);
    else if (state.target?.members && target.pane === "canvas") void updateMatches(false);
  };
}
export function openFind() {
  if (state.target?.pane === lastPane && available(state.target)) {
    publish({ focus: state.focus + 1 });
    return;
  }
  const canvases = canvasTargets();
  const target: FindTarget | undefined =
    lastPane === "canvas"
      ? canvases.length
        ? {
            pane: "canvas",
            label: canvases.length === 1 ? canvases[0].label : "canvas",
            element: () => canvasTargets()[0]?.element() ?? null,
            search: () => [],
            members: canvasTargets,
          }
        : undefined
      : [...targets].find((t) => t.pane === "chat" && available(t));
  if (!target) return;
  closeFind(false);
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  publish({ target, query: queries[target.pane], matches: [], index: 0, focus: state.focus + 1 });
  void updateMatches(true);
}
export function closeFind(restoreFocus = true) {
  request++;
  cancelAnimationFrame(pendingFrame);
  pendingFrame = 0;
  pendingReveal = false;
  members().forEach((t) => t.clear?.());
  CSS.highlights.delete("find-matches");
  CSS.highlights.delete("find-current");
  const fallback = state.target?.element();
  if (state.target) publish({ target: null, matches: [], index: 0, searching: false, error: null });
  if (restoreFocus) {
    if (returnFocus?.isConnected && returnFocus !== document.body) returnFocus.focus();
    else fallback?.focus({ preventScroll: true });
  }
}
export function setFindQuery(query: string) {
  if (state.target) queries[state.target.pane] = query;
  publish({ query, index: 0, matches: [] });
  void updateMatches(true, false);
}
export function toggleFindCase() {
  publish({ matchCase: !state.matchCase, index: 0, matches: [] });
  void updateMatches(true, false);
}
export function nextFind(backwards = false) {
  if (!state.target) {
    openFind();
    return;
  }
  if (!state.matches.length || state.searching) return;
  publish({
    index: (state.index + (backwards ? -1 : 1) + state.matches.length) % state.matches.length,
  });
  paint(true);
}
function collectMatches(reveal: boolean, key?: string) {
  const matches = state.query
    ? members().flatMap((t) => t.search(state.query, state.matchCase))
    : [];
  const found = key ? matches.findIndex((m) => m.key === key) : -1;
  const index = found >= 0 ? found : Math.min(state.index, Math.max(0, matches.length - 1));
  publish({ matches, index });
  paint(reveal);
}
async function updateMatches(reveal: boolean, preserve = true) {
  if (!state.target) return;
  const generation = ++request;
  const key = preserve ? state.matches[state.index]?.key : undefined;
  const files = state.query ? members().filter((t) => t.prepare) : [];
  if (!files.length) {
    publish({ searching: false, error: null });
    collectMatches(reveal, key);
    return;
  }
  publish({ searching: true, error: null });
  CSS.highlights.delete("find-matches");
  CSS.highlights.delete("find-current");
  let next = 0;
  const failures: string[] = [];
  // Bound file reads: a large canvas must not enqueue thousands of git requests ahead of other app work.
  await Promise.all(
    Array.from({ length: Math.min(4, files.length) }, async () => {
      while (generation === request && next < files.length) {
        const target = files[next++];
        try {
          await target.prepare!();
        } catch {
          failures.push(target.label);
        }
      }
    }),
  );
  if (generation !== request) return;
  publish({
    searching: false,
    error: failures.length
      ? `Could not search ${failures.length} file${failures.length === 1 ? "" : "s"}: ${failures.join(", ")}`
      : null,
  });
  collectMatches(reveal, key);
}
// Recompute for expanded context and streamed chat, and reapply ranges after Pierre replaces virtualized rows.
export function refreshFind(target: FindTarget) {
  if (!members().includes(target) || pendingFrame) return;
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = 0;
    if (state.searching) return;
    const key = state.matches[state.index]?.key;
    collectMatches(pendingReveal, key);
  });
}
function paint(reveal: boolean) {
  const match = state.matches[state.index];
  if (reveal && match) match.reveal();
  const highlights = new Highlight();
  for (const m of state.matches) {
    const range = m.range();
    if (range) highlights.add(range);
  }
  const current = match?.range();
  CSS.highlights.set("find-matches", highlights);
  CSS.highlights.set("find-current", new Highlight(...(current ? [current] : [])));
  // An estimated jump mounts a distant file/line; post-render then centres the actual text.
  pendingReveal = !!match && reveal && !current;
}

// Range-based highlights preserve React/Pierre's DOM and the user's selection, even across syntax tokens.
export function textRange(
  element: Element | null | undefined,
  start: number,
  end: number,
): Range | null {
  if (!element) return null;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let at = 0,
    began = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (!began && start < at + length) {
      range.setStart(node, start - at);
      began = true;
    }
    if (began && end <= at + length) {
      range.setEnd(node, end - at);
      return range;
    }
    at += length;
  }
  return null;
}

export const findHighlightCSS = `
::highlight(find-matches) { background-color: #facc1566; color: inherit; }
::highlight(find-current) { background-color: #fb923c; color: #171717; }
`;

export function chatFindTarget(element: () => HTMLElement | null): FindTarget {
  return {
    pane: "chat",
    label: "conversation",
    element,
    clear: () =>
      element()
        ?.querySelectorAll("[data-find-revealed]")
        .forEach((e) => e.removeAttribute("data-find-revealed")),
    search: (query, matchCase) =>
      [...(element()?.querySelectorAll<HTMLElement>("[data-find-entry]") ?? [])].flatMap(
        (entry) => {
          // Search content blocks separately so adjacent paragraphs don't turn into fictitious words.
          const blocks = entry.querySelectorAll<HTMLElement>(
            "p, pre, li, h1, h2, h3, h4, td, th, [data-find-text]",
          );
          const leaves = [...blocks].filter(
            (b) => ![...blocks].some((other) => b !== other && b.contains(other)),
          );
          return leaves.flatMap((block, blockIndex) =>
            findText(block.textContent ?? "", query, matchCase).map(([start, end]) => ({
              key: `${entry.dataset.findEntry}:${blockIndex}:${start}:${end}`,
              range: () => textRange(block, start, end),
              reveal: () => {
                entry.setAttribute("data-find-revealed", "");
                const range = textRange(block, start, end);
                const scroller = element();
                if (range && scroller) {
                  const box = range.getBoundingClientRect();
                  const viewport = scroller.getBoundingClientRect();
                  scroller.scrollTop += box.top - viewport.top - viewport.height / 2;
                }
              },
            })),
          );
        },
      ),
  };
}
