import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ProseAnchor, ReviewEntry } from "../../core/entries";
import { DraftBox, EntryThread, postEntry, quoted } from "./Thread";
import type { Ask, Turn } from "./Viewer";

// ADR 0036: threads on a view's prose. The section's text is its prose's text nodes in order, leaving out diagrams
// (drawn late) and the threads shown between its blocks; a thread's quote is found at its offset in that text (or, if
// the renderer changed, the first place it reads the same), highlighted, and the thread shown after the block the
// quote ends in. Right-click on a selection (or on a block, for all of it) offers Comment.

// Where a thread goes: after this block (data-block) of this prose part (data-part) of the section.
type Place = { part: number; block: number };
const key = (p: Place) => `${p.part}.${p.block}`;

// What renders after each block of a part's prose, for ViewProse.
export const ProseBlockEnd = createContext<
  ((part: number, block: number) => ReactNode) | undefined
>(undefined);
export const useBlockEnd = (part: number) => {
  const after = useContext(ProseBlockEnd);
  return after && ((block: number) => after(part, block));
};

// Every section's quotes, highlighted as one set.
const quotes = new Highlight();
CSS.highlights.set("prose-quote", quotes);

function textNodes(section: HTMLElement): Text[] {
  const nodes: Text[] = [];
  for (const part of section.querySelectorAll("[data-part]")) {
    const walker = document.createTreeWalker(part, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.parentElement?.closest(".mermaid, [data-prose-thread]")
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  }
  return nodes;
}

// A point in the page as an offset into the section's text: the length of the text before it.
function offsetOf(nodes: Text[], container: Node, offset: number): number {
  const point = document.createRange();
  point.setStart(container, offset);
  let at = 0;
  for (const n of nodes) {
    if (n === container) return at + offset;
    if (point.comparePoint(n, 0) >= 0) return at;
    at += n.length;
  }
  return at;
}

// The text from start to end as a range, or null if the section's text is shorter.
function rangeOf(nodes: Text[], start: number, end: number): Range | null {
  const range = document.createRange();
  let at = 0;
  let started = false;
  for (const n of nodes) {
    if (!started && start < at + n.length) {
      range.setStart(n, start - at);
      started = true;
    }
    if (started && end <= at + n.length) {
      range.setEnd(n, end - at);
      return range;
    }
    at += n.length;
  }
  return null;
}

// The block the range ends in.
function placeOf(range: Range): Place | null {
  const end = range.endContainer;
  const el = (end instanceof Element ? end : end.parentElement)?.closest("[data-block]");
  const part = el?.closest("[data-part]");
  return el && part
    ? { part: Number(part.getAttribute("data-part")), block: Number(el.getAttribute("data-block")) }
    : null;
}

type Draft = ProseAnchor & Place;

// A view section's threads on its prose, around the section's parts (children), which render ViewProse.
export function ProseThreads(props: {
  workspaceId: number;
  canPost: boolean; // the workspace has a PR, for Post to GitHub
  viewId: number;
  section: number;
  entries: ReviewEntry[]; // the workspace's
  turns: Record<number, Turn>;
  onAsk: Ask;
  onAnswerPermission: (threadId: number, id: string, optionId: string) => void;
  children: ReactNode;
}) {
  const { viewId, section, entries } = props;
  const root = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [places, setPlaces] = useState<Record<number, string>>({});
  const threads = entries.filter(
    (e) => e.viewId === viewId && e.section === section && !e.parentId,
  );

  // After each render: where each current thread's quote is now, and its highlight.
  const highlighted = useRef<Range[]>([]);
  useLayoutEffect(() => {
    if (!root.current) return;
    const nodes = textNodes(root.current);
    const text = nodes.map((n) => n.data).join("");
    const next: Record<number, string> = {};
    const ranges: Range[] = [];
    for (const e of threads) {
      const quote = e.code ?? "";
      if (e.state !== "current" || !quote) continue;
      const at = text.startsWith(quote, e.quoteAt ?? 0) ? e.quoteAt! : text.indexOf(quote);
      const range = at >= 0 && rangeOf(nodes, at, at + quote.length);
      const place = range && placeOf(range);
      if (!range || !place) continue;
      next[e.id] = key(place);
      if (!e.resolvedAt) ranges.push(range);
    }
    const drafted = draft && rangeOf(nodes, draft.at, draft.at + draft.quote.length);
    if (drafted) ranges.push(drafted);
    highlighted.current.forEach((r) => quotes.delete(r));
    ranges.forEach((r) => quotes.add(r));
    highlighted.current = ranges;
    if (JSON.stringify(next) !== JSON.stringify(places)) setPlaces(next);
  });
  useEffect(() => () => highlighted.current.forEach((r) => quotes.delete(r)), []);

  // Right-click: Comment on the text selected in this section's prose, or on the block under the pointer.
  const onContextMenu = (e: React.MouseEvent) => {
    const target = e.target as Element;
    if (!root.current || !target.closest("[data-part]") || target.closest("[data-prose-thread]"))
      return;
    const selection = getSelection();
    let range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    if (!range || range.collapsed || !root.current.contains(range.commonAncestorContainer)) {
      const block = target.closest("[data-block]");
      if (!block) return;
      range = document.createRange();
      range.selectNodeContents(block);
    }
    const nodes = textNodes(root.current);
    const text = nodes.map((n) => n.data).join("");
    const start = offsetOf(nodes, range.startContainer, range.startOffset);
    const end = offsetOf(nodes, range.endContainer, range.endOffset);
    const quote = text.slice(start, end);
    const place = placeOf(rangeOf(nodes, start, end) ?? range);
    if (!quote.trim() || !place) return;
    e.preventDefault();
    void window.coxswain.showProseMenu().then(() => {
      getSelection()?.removeAllRanges();
      setDraft({ viewId, section, quote, at: start, ...place });
    });
  };

  const byPlace = Map.groupBy(
    threads.filter((e) => places[e.id]),
    (e) => places[e.id],
  );
  const thread = (e: ReviewEntry) => (
    <EntryThread
      key={e.id}
      root={e}
      entries={entries}
      turn={props.turns[e.id]}
      canPost={props.canPost}
      onAsk={props.onAsk}
      onAnswerPermission={props.onAnswerPermission}
    />
  );
  const after = (part: number, block: number) => {
    const here = byPlace.get(key({ part, block })) ?? [];
    const drafting = draft && key(draft) === key({ part, block });
    if (!here.length && !drafting) return null;
    return (
      <div data-prose-thread className="my-2 max-w-[72ch] select-none">
        {here.map(thread)}
        {drafting && (
          <DraftBox
            label={quoted(draft.quote)}
            canPost={props.canPost}
            onSend={(body, toAgent, post) => {
              const { part: _, block: __, ...anchor } = draft;
              void postEntry(
                { workspaceId: props.workspaceId, body, anchor },
                toAgent,
                props.onAsk,
                post,
              );
              setDraft(null);
            }}
            onCancel={() => setDraft(null)}
          />
        )}
      </div>
    );
  };
  // Threads whose quote isn't there: outdated (the section was rewritten), or not found. At the top of the section.
  const unplaced = threads.filter((e) => !places[e.id]);
  return (
    <div ref={root} onContextMenu={onContextMenu}>
      {unplaced.length > 0 && (
        <div data-prose-thread className="max-w-[72ch] px-6 select-none">
          {unplaced.map(thread)}
        </div>
      )}
      <ProseBlockEnd.Provider value={after}>{props.children}</ProseBlockEnd.Provider>
    </div>
  );
}
