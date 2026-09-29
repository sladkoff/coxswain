import type { DiffLineAnnotation, LineAnnotation, SelectedLineRange } from "@pierre/diffs";
import { File, MultiFileDiff } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { memo, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { ChatEntry, Permission } from "../../core/agents";
import type { ChangedFile, CodeLineList, FileText } from "../../core/git";
import type { NewEntry, ReviewEntry } from "../../core/review";
import type { Workspace } from "../../core/workspaces";
import { Button } from "./components/button";
import { useCodeFind } from "./code-find";
import { findHighlightCSS } from "./find";
import { Centered } from "./components/layout";
import { cn, divider, muted } from "./components/styles";
import { ProblemMessage } from "./components/text";
import { changed, core, queryClient } from "./queries";
import { type Draft, DraftBox, lines, ThreadBox } from "./Thread";

// What the Viewer shows: the file diff of a changed file, or a whole file as it is in the worktree, scrolled to a
// line with `line` (Go to Definition, Find Usages).
export type Opened =
  | { kind: "diff"; file: ChangedFile }
  | { kind: "file"; path: string; line?: number };
export const openedPath = (opened: Opened) =>
  opened.kind === "diff" ? opened.file.path : opened.path;

// A question's turn in a thread: the reply streamed so far (live) until it's saved as an answer entry, and a tool use
// waiting for the user's approval.
export type Turn = {
  running: boolean;
  error: string | null;
  live: ChatEntry[];
  permission: Permission | null;
};
type Ask = (question: NewEntry | { workspaceId: number; threadId: number }) => void;

// What an inline box between the lines shows: an entry with its thread, or the form for a new one.
// One object type, not a union: the library's annotation types distribute over unions.
type Box = { entry?: ReviewEntry; draft?: Draft };

type Props = {
  workspace: Workspace;
  mergeBase: string;
  // A pinned range: file and diff contents, notes and Reviewed all use this revision.
  head?: string;
  opened: Opened;
  entries: ReviewEntry[]; // the workspace's
  // This file diff's, not the list: a tick must only redraw the file diff ticked.
  reviewed: boolean;
  onReviewedChange: (path: string, reviewed: boolean, kind?: "file") => void;
  turns: Record<number, Turn>; // by thread
  onAsk: Ask;
  onAnswerPermission: (threadId: number, id: string, optionId: string) => void;
  onOpenFile: (path: string, line: number) => void; // a whole file on the canvas at that line
  diffStyle: "unified" | "split";
  // One of several file diffs one after another: the parent scrolls, not the Viewer.
  stacked?: boolean;
  revealThread?: number; // navigation also opens outdated threads and forces this file to load
};

// The side of a file diff that isn't read: an added file's old side, a deleted one's new side, a whole file's old side.
// Module-level, so the memoised files below keep their identity.
const emptyText: FileText = { status: "ok", text: "", binary: false };
const noText: FileText = { status: "ok", text: null, binary: false };

const baseOptions = {
  preferredHighlighter: "shiki-js",
  overflow: "wrap",
  stickyHeader: true,
  // Go to Definition: a token under the pointer while ⌘ is held reads as a link.
  unsafeCSS:
    "[data-definition-link] { text-decoration: underline; cursor: pointer; }" + findHighlightCSS,
} as const;

// L3: shows the diff or file opened from the Navigator.
// The old side is the merge base (git show), the new side the worktree now.
// The + in the gutter (click, or drag for a range) starts a note or question on those lines.
// Memoised, and so are the files and annotations it hands the library: @pierre/diffs re-diffs on a new file
// object and redraws on every render, so the canvas's many Viewers must only render when their props change.
export const Viewer = memo(function Viewer(props: Props) {
  const { workspace, mergeBase, head, opened, entries } = props;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showOutdated, setShowOutdated] = useState(false);
  // The highlighted lines. Controlled, so they can be cleared when a draft is cancelled or saved: left to
  // itself the library keeps the old selection and extends it on the next drag.
  const [selection, setSelection] = useState<SelectedLineRange | null>(null);
  const closeDraft = () => {
    setDraft(null);
    setSelection(null);
  };
  const path = openedPath(opened);
  const revealed = entries.find((e) => e.id === props.revealThread && e.path === path);
  // A stacked file diff reads its file only once it scrolls near the screen: a big PR has thousands, and reading
  // them all at once queues every other call behind thousands of git processes.
  const [wasNear, setNear] = useState(!props.stacked);
  const near = wasNear || !!revealed;
  const placeholder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = placeholder.current;
    if (near || !el) return;
    const o = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setNear(true), {
      root: el.closest(".overflow-auto"),
      rootMargin: "1500px 0px",
    });
    o.observe(el);
    return () => o.disconnect();
  }, [near]);

  // Rereading after an agent turn keeps the old text in place until the new text is in.
  const readOld = opened.kind === "diff" && opened.file.status !== "added";
  const readNew = !(opened.kind === "diff" && opened.file.status === "deleted");
  const oldPath = opened.kind === "diff" ? (opened.file.previousPath ?? path) : path;
  const oldSide = useQuery({
    ...core("readFileAt", workspace.id, mergeBase, oldPath),
    enabled: near && readOld,
  }).data;
  const newSide = useQuery({
    ...(head
      ? core("readFileAt", workspace.id, head, path)
      : core("readWorktreeFile", workspace.id, path)),
    enabled: near && readNew,
  }).data;
  const o = readOld ? oldSide : opened.kind === "file" ? noText : emptyText;
  const n = readNew ? newSide : emptyText;
  useEffect(closeDraft, [opened]);

  // Go to Definition: ⌘ over a token underlines it, ⌘-click opens where it's defined, picked from a menu if several.
  // A right-click on a token offers it and Find Usages, whose results always show in the menu, even one: it may be the
  // line clicked. ponytail: the picker is a native menu of the first 30, a results pane if long lists need browsing.
  const hovered = useRef<{ element: HTMLElement; text: string } | null>(null);
  useEffect(() => {
    const mark = (e: KeyboardEvent) =>
      hovered.current?.element.toggleAttribute("data-definition-link", e.metaKey);
    window.addEventListener("keydown", mark);
    window.addEventListener("keyup", mark);
    return () => {
      window.removeEventListener("keydown", mark);
      window.removeEventListener("keyup", mark);
    };
  }, []);
  // Shows a result line: at once if it's the only definition, else picked from a menu that says when there's none.
  const showLine = async (found: CodeLineList, what: "definition" | "usages") => {
    const all = found.status === "ok" ? found.lines : [];
    const ls = all.slice(0, 30);
    const i =
      what === "definition" && ls.length === 1
        ? 0
        : await window.coxswain.showCodeLinesMenu(
            ls.map((l) => `${l.path}:${l.line}   ${l.text.slice(0, 60)}`),
            all.length - ls.length,
            found.status !== "ok"
              ? found.message
              : what === "definition"
                ? "No definition found"
                : "No usages found",
          );
    props.onOpenFile(ls[i].path, ls[i].line);
  };
  const goToDefinition = async (token: string) =>
    showLine(await window.coxswain.findDefinitions(workspace.id, path, token), "definition");
  const tokenMenu = async (e: MouseEvent) => {
    const token = hovered.current?.text;
    if (!token) return;
    e.preventDefault();
    const action = await window.coxswain.showTokenMenu();
    if (action === "definition") goToDefinition(token);
    else showLine(await window.coxswain.findUsages(workspace.id, token), "usages");
  };

  const files = useMemo(() => {
    const text = (f: FileText) => (f.status === "ok" ? (f.text ?? "") : "");
    return (
      o &&
      n && { old: { name: oldPath, contents: text(o) }, new: { name: path, contents: text(n) } }
    );
  }, [o, n]);
  const root = useRef<HTMLDivElement>(null);
  const onPostRender = useCodeFind<Box>({
    root,
    placeholder,
    path,
    kind: opened.kind,
    files: files || undefined,
    identity: `${workspace.id}:${mergeBase}:${head ?? "live"}:${opened.kind}:${path}`,
    reveal: () => setNear(true),
    load: async () => {
      const [old, next] = await Promise.all([
        readOld
          ? queryClient.fetchQuery({
              ...core("readFileAt", workspace.id, mergeBase, oldPath),
              staleTime: Infinity,
            })
          : emptyText,
        readNew
          ? queryClient.fetchQuery({
              ...(head
                ? core("readFileAt", workspace.id, head, path)
                : core("readWorktreeFile", workspace.id, path)),
              staleTime: Infinity,
            })
          : emptyText,
      ]);
      if (old.status !== "ok" || next.status !== "ok") throw new Error(`Could not read ${path}`);
      if (old.binary || next.binary) return null;
      return {
        old: { name: oldPath, contents: old.text ?? "" },
        new: { name: path, contents: next.text ?? "" },
      };
    },
  });

  const options = useMemo(
    () => ({
      ...baseOptions,
      onPostRender,
      diffStyle: props.diffStyle,
      enableGutterUtility: true,
      // In a diff the range has a side; a whole file is always the worktree. ponytail: a range spanning
      // both sides of a diff is taken as the side it ends on.
      onGutterUtilityClick: (r: SelectedLineRange) =>
        setDraft({
          side: (r.endSide ?? r.side) === "deletions" ? "old" : "new",
          startLine: r.start,
          endLine: r.end,
        }),
      onLineSelectionChange: setSelection,
      onTokenEnter: (t: { tokenElement: HTMLElement; tokenText: string }, e: PointerEvent) => {
        if (!/\w/.test(t.tokenText)) return;
        hovered.current = { element: t.tokenElement, text: t.tokenText };
        t.tokenElement.toggleAttribute("data-definition-link", e.metaKey);
      },
      onTokenLeave: (t: { tokenElement: HTMLElement }) => {
        t.tokenElement.removeAttribute("data-definition-link");
        hovered.current = null;
      },
      onTokenClick: (t: { tokenText: string }, e: MouseEvent) =>
        e.metaKey && void goToDefinition(t.tokenText),
    }),
    [props.diffStyle, workspace.id, path, props.onOpenFile, onPostRender],
  );

  const annotations = useMemo(() => {
    // Threads show under their first question, so only anchored entries without a parent get a box.
    // A whole file shows the new side (snapshot or worktree), so only new-side entries belong in it.
    // Only current entries go between the lines (ADR 0015); outdated ones open from the header.
    const boxes: { side: "old" | "new"; line: number; box: Box }[] = [
      ...entries
        .filter(
          (e) =>
            e.path === path &&
            !e.parentId &&
            e.state === "current" &&
            (opened.kind === "diff" || e.side === "new"),
        )
        .map((e) => ({ side: e.side!, line: e.endLine!, box: { entry: e } })),
      ...(draft
        ? [{ side: draft.side, line: Math.max(draft.startLine, draft.endLine), box: { draft } }]
        : []),
    ];
    return {
      file: boxes.map((a): LineAnnotation<Box> => ({ lineNumber: a.line, metadata: a.box })),
      diff: boxes.map((a): DiffLineAnnotation<Box> => ({
        side: a.side === "old" ? "deletions" : "additions",
        lineNumber: a.line,
        metadata: a.box,
      })),
    };
  }, [entries, draft, opened]);

  // Go to Definition's line: selected, and scrolled to once the library has drawn it.
  useEffect(() => {
    const line = opened.kind === "file" && opened.line;
    if (!line || !files) return;
    setSelection({ start: line, end: line });
    let tries = 40;
    const find = () => {
      const el = root.current
        ?.querySelector("diffs-container")
        ?.shadowRoot?.querySelector(`[data-line="${line}"]`);
      if (el) el.scrollIntoView({ block: "center" });
      else if (tries--) setTimeout(find, 50);
    };
    find();
  }, [opened, !!files]);

  if (!near) {
    // Roughly the file diff's height, so scrolling to a file further down lands near it.
    const height =
      opened.kind === "diff"
        ? 44 + 20 * Math.min(opened.file.additions + opened.file.deletions + 6, 200)
        : 400;
    return (
      <div
        ref={placeholder}
        style={{ height }}
        className={cn("border-b px-3 py-2 text-xs", divider, muted)}
      >
        {path}
      </div>
    );
  }
  if (!o || !n || !files)
    return (
      <div ref={placeholder}>
        <Centered>Loading…</Centered>
      </div>
    );
  if (o.status !== "ok" || n.status !== "ok")
    return (
      <div ref={placeholder}>
        <Centered>
          <ProblemMessage
            problem={o.status !== "ok" ? o : (n as Exclude<FileText, { status: "ok" }>)}
          />
        </Centered>
      </div>
    );
  if (o.binary || n.binary)
    return (
      <div ref={placeholder}>
        <Centered>Binary file, not shown</Centered>
      </div>
    );

  const anchored = (d: Draft, body: string): NewEntry => {
    const [start, end] = [d.startLine, d.endLine].sort((a, b) => a - b);
    const text = (d.side === "old" ? o.text : n.text) ?? "";
    const code = text
      .split("\n")
      .slice(start - 1, end)
      .join("\n");
    const anchor = {
      path,
      side: d.side,
      startLine: start,
      endLine: end,
      code,
      base: mergeBase,
      head: head ?? null,
    };
    return { workspaceId: workspace.id, body, anchor };
  };
  // A note, or with toAgent a question for the agent pane's session; its answer goes in the thread.
  const post = async (e: NewEntry, toAgent: boolean) => {
    if (toAgent) return props.onAsk(e);
    await window.coxswain.addNote(e);
    changed({ workspaceId: workspace.id, what: "entries" });
  };
  const edit = async (e: ReviewEntry, body: string) => {
    await window.coxswain.editEntry(e.id, body);
    changed({ workspaceId: workspace.id, what: "entries" });
  };
  const resolve = async (e: ReviewEntry, resolved: boolean) => {
    await window.coxswain.resolveThread(e.id, resolved);
    changed({ workspaceId: workspace.id, what: "entries" });
  };
  const remove = async (e: ReviewEntry) => {
    await window.coxswain.deleteEntry(e.id);
    changed({ workspaceId: workspace.id, what: "entries" });
  };
  const render = ({ draft, entry }: Box) =>
    draft ? (
      <DraftBox
        draft={draft}
        onSend={(body, toAgent) => {
          post(anchored(draft, body), toAgent);
          closeDraft();
        }}
        onCancel={closeDraft}
      />
    ) : entry ? (
      <ThreadBox
        root={entry}
        replies={entries.filter((e) => e.parentId === entry.id)}
        turn={props.turns[entry.id]}
        onReply={(body, toAgent) =>
          post({ workspaceId: workspace.id, body, parentId: entry.id }, toAgent)
        }
        onStop={() => window.coxswain.stopQuestion(workspace.id)}
        onAnswerPermission={(id, optionId) => props.onAnswerPermission(entry.id, id, optionId)}
        onEdit={(body) => edit(entry, body)}
        onResolve={(resolved) => resolve(entry, resolved)}
        onRemove={() => remove(entry)}
        onSend={() => props.onAsk({ workspaceId: workspace.id, threadId: entry.id })}
      />
    ) : null;

  const outdated = entries.filter((e) => e.path === path && !e.parentId && e.state === "outdated");

  return (
    <div
      ref={root}
      tabIndex={-1}
      onContextMenu={(e) => void tokenMenu(e.nativeEvent)}
      className={props.stacked ? "select-text" : "min-h-0 flex-1 overflow-auto select-text"}
    >
      {(showOutdated || revealed?.state === "outdated") && (
        <OutdatedThreads entries={outdated} renderThread={(entry) => render({ entry })} />
      )}
      {opened.kind === "file" ? (
        <File<Box>
          file={files.new}
          options={options}
          selectedLines={selection}
          lineAnnotations={annotations.file}
          renderAnnotation={(a) => render(a.metadata)}
          renderHeaderMetadata={
            props.stacked
              ? () => (
                  <DiffHeaderActions
                    outdated={outdated.length}
                    onToggleOutdated={() => setShowOutdated((s) => !s)}
                    reviewed={props.reviewed}
                    onReviewedChange={(on) => props.onReviewedChange(path, on, "file")}
                  />
                )
              : undefined
          }
        />
      ) : (
        <MultiFileDiff<Box>
          oldFile={files.old}
          newFile={files.new}
          options={options}
          selectedLines={selection}
          lineAnnotations={annotations.diff}
          renderAnnotation={(a) => render(a.metadata)}
          renderHeaderMetadata={() => (
            <DiffHeaderActions
              outdated={outdated.length}
              onToggleOutdated={() => setShowOutdated((s) => !s)}
              reviewed={props.reviewed}
              onReviewedChange={(on) => props.onReviewedChange(path, on)}
            />
          )}
        />
      )}
    </div>
  );
});

// Above a file diff: its threads about code that has changed since (ADR 0015), each with the code it was about.
function OutdatedThreads({
  entries,
  renderThread,
}: {
  entries: ReviewEntry[];
  renderThread: (e: ReviewEntry) => ReactNode;
}) {
  return (
    <div className={cn("border-b bg-neutral-50 py-1 dark:bg-neutral-950", divider)}>
      {entries.map((e) => (
        <div key={e.id} className="mx-2 mt-1">
          <div className={cn("px-2 text-xs", muted)}>
            Outdated · {lines(e.startLine!, e.endLine!)}
            {e.side === "old" && ", removed"}: the code it was about has changed.
          </div>
          <pre className="mx-2 mt-1 overflow-x-auto rounded bg-neutral-100 p-1.5 font-mono text-xs dark:bg-neutral-800">
            {e.code}
          </pre>
          {renderThread(e)}
        </div>
      ))}
    </div>
  );
}

// On a file diff's header: how many outdated threads (a click shows them) and the Reviewed checkbox.
function DiffHeaderActions(props: {
  outdated: number;
  onToggleOutdated: () => void;
  reviewed: boolean;
  onReviewedChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {props.outdated > 0 && (
        <Button
          variant="ghost"
          title="Notes and questions about code that has changed since"
          className={cn("px-1 font-sans text-xs", muted)}
          onClick={props.onToggleOutdated}
        >
          {props.outdated} outdated
        </Button>
      )}
      <label className="flex items-center gap-1 font-sans text-xs select-none">
        <input
          type="checkbox"
          checked={props.reviewed}
          onChange={(e) => props.onReviewedChange(e.target.checked)}
        />
        Reviewed
      </label>
    </div>
  );
}
