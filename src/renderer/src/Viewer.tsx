import { codeSymbolAtPoint } from "./code-symbol";
import { match, P } from "ts-pattern";
import { useCodeLine } from "./use-code-line";
import type { CodeLine } from "./source-destination";
import { useCodeThemeType } from "./components/useCodeThemeType";
import { fileContents } from "./components/file-contents";
import { holdScrollPosition } from "./components/hold-scroll-position";
import type { DiffLineAnnotation, LineAnnotation, SelectedLineRange } from "@pierre/diffs";
import { File, MultiFileDiff } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChatEntry, Permission } from "../../core/agents";
import type { ChangedFile, FileText } from "../../core/git";
import type { CodeAt, CodeLineList } from "../../core/lsp";
import type { NewEntry, ReviewEntry } from "../../core/review";
import type { Workspace } from "../../core/workspaces";
import { Button } from "./components/button";
import { codeThemes } from "./components/code-theme";
import { ReviewCorners } from "./components/ReviewCorners";
import { useCodeFind } from "./code-find";
import { findHighlightCSS } from "./find";
import { Centered } from "./components/layout";
import { cn, divider, muted, reviewCard, reviewGutter } from "./components/styles";
import { ProblemMessage } from "./components/text";
import { core, queryClient } from "./queries";
import { type Draft, DraftBox, EntryThread, lines, postEntry } from "./Thread";

// What the Viewer shows: the file diff of a changed file, or a whole file as it is in the worktree (or at `commit`, where
// Go to Definition or Find Usages found it), scrolled to a line with `line`.
export type Opened =
  | { kind: "diff"; file: ChangedFile }
  | { kind: "file"; path: string; line?: number; commit?: string };
export const openedPath = (opened: Opened) =>
  opened.kind === "diff" ? opened.file.path : opened.path;

// A question's turn in a thread: the reply streamed so far (live) until it's saved as an answer entry, and a tool use
// waiting for the user's approval.
export type Turn = {
  running: boolean;
  queued: boolean; // waiting behind the session's running turn
  error: string | null;
  live: ChatEntry[];
  permission: Permission | null;
};
export type Ask = (question: NewEntry | { workspaceId: number; threadId: number }) => void;

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
  onOpenFile: (path: string, line: number, commit?: string) => void; // prefer the current visible review file at that revision
  diffStyle: "unified" | "split";
  // One of several file diffs one after another: the parent scrolls, not the Viewer.
  stacked?: boolean;
  editor?: boolean; // whole file fills the Files editor beneath its tabs, without card chrome
  onCollapsedChange?: (path: string, collapsed: boolean, kind?: "file") => void;
  codeLine?: CodeLine;
  codeLineVersion?: string;
  codeLinePassive?: boolean;
  revealVersion?: number;
  onThreadResolved?: (id: number) => void;
  collapsed?: boolean; // only its header, e.g. a reviewed file diff in a view
  revealThread?: number; // navigation also opens outdated threads and forces this file to load
};

// A token under the pointer, as @pierre/diffs reports it: side only in a file diff.
type Token = {
  tokenElement: HTMLElement;
  tokenText: string;
  lineNumber: number;
  lineCharStart: number;
  side?: "deletions" | "additions";
};

// The side of a file diff that isn't read: an added file's old side, a deleted one's new side, a whole file's old side.
// Module-level, so the memoised files below keep their identity.
const emptyText: FileText = { status: "ok", text: "", binary: false };
const noText: FileText = { status: "ok", text: null, binary: false };

// Keep Pierre's chevron geometry, with four extra units between the paired arrows.
const expandBothMask = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 20"><g fill="white"><path transform="translate(0 4)" d="M11.47 9.47a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 1 1 1.06-1.06L8 12.94z"/><path d="M7.526 1.418a.75.75 0 0 1 1.004.052l4 4a.75.75 0 1 1-1.06 1.06L8 3.06 4.53 6.53a.75.75 0 1 1-1.06-1.06l4-4z"/></g></svg>',
)}")`;

// Restyle Pierre's existing context controls; their expansion behavior and measured heights stay native to the library.
const diffChromeCSS = `
  :host { --diffs-bg: var(--review-file-bg); --diffs-bg-separator-override: transparent; }
  [data-line-annotation], [data-gutter-buffer="annotation"] { --diffs-annotation-bg: var(--diffs-bg); }
  [data-indicators="bars"] [data-column-number]:is([data-line-type="change-addition"], [data-line-type="change-deletion"])::before { width: 1px; }
  [data-separator="line-info"] [data-separator-content],
  [data-separator="line-info-basic"] [data-separator-content] {
    gap: 12px;
    justify-content: center;
  }
  [data-separator="line-info"] [data-separator-content]::before,
  [data-separator="line-info"] [data-separator-content]::after,
  [data-separator="line-info-basic"] [data-separator-content]::before,
  [data-separator="line-info-basic"] [data-separator-content]::after {
    content: "";
    flex: 1 1 0;
    border-top: 0.5px solid color-mix(in srgb, var(--diffs-fg) 12%, transparent);
  }
  [data-separator] [data-separator-wrapper] {
    grid-template-columns: var(--review-number-gutter, 6ch) auto !important;
    padding-inline-start: 0 !important;
  }
  [data-separator] [data-expand-button] { border-color: transparent; min-width: 0; position: relative; }
  [data-separator] [data-expand-button] [data-icon] {
    position: absolute;
    left: var(--review-number-center, 3.5ch);
    width: 14px;
    height: 14px;
    margin-left: -7px;
  }
  [data-separator] [data-expand-both] [data-icon] {
    height: 17.5px;
    background-color: currentColor;
    mask: ${expandBothMask} center / contain no-repeat;
  }
  [data-separator] [data-expand-both] [data-icon] use { visibility: hidden; }
  :host-context([data-appearance="soft-dark"]) :is([data-line], [data-column-number], [data-gutter-buffer], [data-no-newline])[data-line-type="change-addition"] {
    --diffs-computed-diff-line-bg: #2a332f;
  }
  :host-context([data-appearance="soft-dark"]) :is([data-line], [data-column-number], [data-gutter-buffer], [data-no-newline])[data-line-type="change-deletion"] {
    --diffs-computed-diff-line-bg: #392d30;
  }
`;

const baseOptions = {
  preferredHighlighter: "shiki-js",
  overflow: "wrap",
  disableFileHeader: true,
  // Go to Definition: a token under the pointer while ⌘ is held reads as a link.
  unsafeCSS:
    diffChromeCSS +
    "[data-definition-link] { cursor: pointer; } ::highlight(code-definition-link) { text-decoration: underline; }" +
    findHighlightCSS,
} as const;

// L3: shows the diff or file opened from the Navigator.
// The old side is the merge base (git show), the new side the worktree now.
// The + in the gutter (click, or drag for a range) starts a note or question on those lines.
// Memoised, and so are the files and annotations it hands the library: @pierre/diffs re-diffs on a new file
// object and redraws on every render, so the canvas's many Viewers must only render when their props change.
export const Viewer = memo(function Viewer(props: Props) {
  const { workspace, mergeBase, head, opened, entries } = props;
  const header = useRef<HTMLDivElement>(null);
  const disclosureScroll = useRef<ReturnType<typeof holdScrollPosition>>(undefined);
  useLayoutEffect(() => {
    disclosureScroll.current?.restore();
  }, [props.collapsed]);
  useEffect(() => () => disclosureScroll.current?.stop(), []);
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
  const codeLine = useMemo(
    () =>
      match({ requested: props.codeLine, opened })
        .when(
          ({ requested }) => requested?.path === path,
          ({ requested }) => requested,
        )
        .with({ opened: { kind: "file", line: P.number.select() } }, (line) => ({
          path,
          line,
          side: "additions" as const,
        }))
        .with(P._, () => undefined)
        .exhaustive(),
    [props.codeLine, opened, path],
  );
  const codeTheme = useQuery(core("getCodeTheme")).data ?? "default";
  const themeType = useCodeThemeType();
  const revealed = entries.find((e) => e.id === props.revealThread && e.path === path);
  // A stacked file diff reads its file only once it scrolls near the screen: a big PR has thousands, and reading
  // them all at once queues every other call behind thousands of git processes.
  const readOld = opened.kind === "diff" && opened.file.status !== "added";
  const readNew = !(opened.kind === "diff" && opened.file.status === "deleted");
  const oldPath = opened.kind === "diff" ? (opened.file.previousPath ?? path) : path;
  const [wasNear, setNear] = useState(
    () =>
      !props.stacked ||
      ((!readOld ||
        queryClient.getQueryData(core("readFileAt", workspace.id, mergeBase, oldPath).queryKey) !==
          undefined) &&
        (!readNew ||
          queryClient.getQueryData(
            (head
              ? core("readFileAt", workspace.id, head, path)
              : core("readWorktreeFile", workspace.id, path)
            ).queryKey,
          ) !== undefined)),
  );
  const near = wasNear || !!revealed || !!codeLine;
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
  }, [near, props.collapsed]);

  // Rereading after an agent turn keeps the old text in place until the new text is in.
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
  const o =
    (readOld ? oldSide : opened.kind === "file" ? noText : emptyText) ??
    (props.collapsed ? emptyText : undefined);
  const n = (readNew ? newSide : emptyText) ?? (props.collapsed ? emptyText : undefined);
  useEffect(closeDraft, [opened]);

  // Go to Definition: ⌘ over a token underlines it, ⌘-click opens where it's defined, picked from a menu if several.
  // A right-click on a token offers it and Find Usages, whose results always show in the menu, even one: it may be the
  // line clicked. Both ask the file's language server at the side's revision (ADR 0034): the old side of a file diff
  // is the base, the new side and a whole file the head, or the worktree when there is none.
  // ponytail: the picker is a native menu of the first 30, a results pane if long lists need browsing.
  const linkHighlight = useMemo(() => new Highlight(), []);
  const hovered = useRef<{ element: HTMLElement; at: CodeAt; range: Range } | null>(null);
  const stopHover = useRef<(() => void) | null>(null);
  const codeAt = (t: Token, character: number): CodeAt => {
    const old = t.side === "deletions";
    return {
      commit: old ? mergeBase : (head ?? null),
      path: old ? oldPath : path,
      line: t.lineNumber,
      character: t.lineCharStart + character,
    };
  };
  const markLink = (metaKey: boolean) => {
    const hit = hovered.current;
    linkHighlight.clear();
    hit?.element.toggleAttribute("data-definition-link", metaKey);
    if (hit && metaKey) {
      CSS.highlights.set("code-definition-link", linkHighlight);
      linkHighlight.add(hit.range);
    }
  };
  const enterToken = (token: Token, event: PointerEvent) => {
    stopHover.current?.();
    const move = (event: PointerEvent) => {
      const symbol = codeSymbolAtPoint(token.tokenElement, event.clientX, event.clientY);
      hovered.current = symbol
        ? { element: token.tokenElement, at: codeAt(token, symbol.start), range: symbol.range }
        : null;
      token.tokenElement.removeAttribute("data-definition-link");
      markLink(event.metaKey);
    };
    token.tokenElement.addEventListener("pointermove", move);
    stopHover.current = () => {
      token.tokenElement.removeEventListener("pointermove", move);
      token.tokenElement.removeAttribute("data-definition-link");
      hovered.current = null;
      linkHighlight.clear();
    };
    move(event);
  };
  useEffect(() => {
    const mark = (event: KeyboardEvent) => markLink(event.metaKey);
    const clear = () => stopHover.current?.();
    window.addEventListener("keydown", mark);
    window.addEventListener("keyup", mark);
    window.addEventListener("blur", clear);
    return () => {
      clear();
      window.removeEventListener("keydown", mark);
      window.removeEventListener("keyup", mark);
      window.removeEventListener("blur", clear);
    };
  }, []);
  // Shows a result line: at once if it's the only definition, else picked from a menu that says when there's none.
  const showLine = async (at: CodeAt, found: CodeLineList, what: "definition" | "usages") => {
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
    props.onOpenFile(ls[i].path, ls[i].line, at.commit ?? undefined);
  };
  const goToDefinition = async (at: CodeAt) =>
    showLine(at, await window.coxswain.findDefinitions(workspace.id, at), "definition");
  const tokenMenu = async (e: MouseEvent) => {
    const at = hovered.current?.at;
    if (!at) return;
    e.preventDefault();
    const action = await window.coxswain.showTokenMenu();
    if (action === "definition") goToDefinition(at);
    else showLine(at, await window.coxswain.findUsages(workspace.id, at), "usages");
  };

  const files = useMemo(
    () => o && n && { old: fileContents(o, oldPath), new: fileContents(n, path) },
    [o, n, oldPath, path],
  );
  const root = useRef<HTMLDivElement>(null);
  const onCodeLineRender = useCodeLine<Box>(
    root,
    props.codeLinePassive ? undefined : codeLine,
    !!files,
    props.codeLineVersion,
    opened.kind,
  );
  const onCodeFindRender = useCodeFind<Box>({
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
        old: fileContents(old, oldPath),
        new: fileContents(next, path),
      };
    },
  });

  const onPostRender = useCallback(
    (...args: Parameters<typeof onCodeFindRender>) => {
      root.current?.removeAttribute("data-diff-pending");
      const shadow = root.current?.querySelector("diffs-container")?.shadowRoot;
      const gutter = shadow?.querySelector<HTMLElement>("[data-column-number]");
      const number = gutter?.querySelector<HTMLElement>("[data-line-number-content]");
      if (root.current && gutter && number) {
        const gutterBox = gutter.getBoundingClientRect();
        const numberBox = number.getBoundingClientRect();
        if (gutterBox.width > 0) {
          root.current.style.setProperty("--review-number-gutter", `${gutterBox.width}px`);
          root.current.style.setProperty(
            "--review-number-center",
            `${numberBox.left - gutterBox.left + numberBox.width / 2}px`,
          );
        }
      }
      onCodeLineRender(...args);
      onCodeFindRender(...args);
    },
    [onCodeFindRender, onCodeLineRender],
  );

  const options = useMemo(
    () => ({
      ...baseOptions,
      theme: codeThemes(codeTheme),
      themeType,
      onPostRender,
      diffStyle: props.diffStyle,
      collapsed: props.collapsed,
      expandUnchanged: !!codeLine,
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
      onTokenEnter: enterToken,
      onTokenLeave: () => stopHover.current?.(),
      onTokenClick: (token: Token, event: MouseEvent) => {
        if (!event.metaKey) return;
        const symbol = codeSymbolAtPoint(token.tokenElement, event.clientX, event.clientY);
        if (symbol) void goToDefinition(codeAt(token, symbol.start));
      },
    }),
    [
      props.diffStyle,
      props.collapsed,
      codeLine,
      codeTheme,
      themeType,
      workspace.id,
      path,
      oldPath,
      mergeBase,
      head,
      props.onOpenFile,
      onPostRender,
    ],
  );

  // Replies and streamed answers change the annotation's contents, not its location.
  // Keep the library's annotation list stable unless an anchored root itself changes.
  const roots = entries.filter((entry) => !entry.parentId);
  const [annotationRoots, setAnnotationRoots] = useState(roots);
  if (
    roots.length !== annotationRoots.length ||
    roots.some((entry, i) => entry !== annotationRoots[i])
  ) {
    setAnnotationRoots(roots);
  }
  const annotations = useMemo(() => {
    // Threads show under their first question, so only anchored entries without a parent get a box.
    // A whole file shows the new side (snapshot or worktree), so only new-side entries belong in it; one at a commit
    // Go to Definition found it at, none: they're about the canvas's range.
    // Only entries whose lines are in this range go between the lines (ADR 0015); outdated ones open from the header.
    const boxes: { side: "old" | "new"; line: number; box: Box }[] = [
      ...annotationRoots
        .filter(
          (e) =>
            e.path === path &&
            !e.parentId &&
            e.shown &&
            (opened.kind === "diff" || (e.side === "new" && !opened.commit)),
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
  }, [annotationRoots, draft, opened]);

  useEffect(() => {
    if (codeLine) setSelection({ start: codeLine.line, end: codeLine.line, side: codeLine.side });
  }, [codeLine]);

  if (!near && !props.collapsed) {
    // Roughly the file diff's height, so scrolling to a file further down lands near it.
    const height =
      opened.kind === "diff"
        ? 44 + 20 * Math.min(opened.file.additions + opened.file.deletions + 6, 200)
        : 400;
    return (
      <div
        ref={placeholder}
        data-diff-pending
        style={{ height }}
        className={cn("border-b px-3 py-2 text-xs", divider, muted)}
      >
        {path}
      </div>
    );
  }
  if (!o || !n || !files)
    return (
      <div
        ref={placeholder}
        data-diff-pending
        className={props.editor ? "min-h-0 flex-1" : undefined}
      >
        <Centered>Loading…</Centered>
      </div>
    );
  if (o.status !== "ok" || n.status !== "ok")
    return (
      <div ref={placeholder} className={props.editor ? "min-h-0 flex-1" : undefined}>
        <Centered>
          <ProblemMessage
            problem={o.status !== "ok" ? o : (n as Exclude<FileText, { status: "ok" }>)}
          />
        </Centered>
      </div>
    );
  if (o.image || n.image)
    return (
      <div
        ref={placeholder}
        className={props.editor ? "min-h-0 flex-1 overflow-auto" : cn("border-b", divider)}
      >
        {opened.kind === "diff" && (
          <div className={cn("px-3 py-2 font-mono text-xs", muted)}>{path}</div>
        )}
        <div className="flex items-start justify-center gap-4 p-4">
          {[o.image, n.image].map(
            (src, i) =>
              src && (
                <img
                  key={i}
                  src={src}
                  alt={path}
                  title={o.image && n.image ? (i ? "After" : "Before") : undefined}
                  className="max-h-[70vh] min-w-0 object-contain"
                />
              ),
          )}
        </div>
      </div>
    );
  if (o.binary || n.binary)
    return (
      <div ref={placeholder} className={props.editor ? "min-h-0 flex-1" : undefined}>
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
  const render = ({ draft, entry }: Box) =>
    draft ? (
      <DraftBox
        label={lines(
          Math.min(draft.startLine, draft.endLine),
          Math.max(draft.startLine, draft.endLine),
        )}
        canPost={workspace.prNumber !== null}
        onSend={(body, toAgent, post) => {
          void postEntry(anchored(draft, body), toAgent, props.onAsk, post);
          closeDraft();
        }}
        onCancel={closeDraft}
      />
    ) : entry ? (
      <EntryThread
        revealed={props.revealThread === entry.id}
        revealVersion={props.revealVersion}
        onResolved={props.onThreadResolved}
        root={entry}
        entries={entries}
        turn={props.turns[entry.id]}
        canPost={workspace.prNumber !== null}
        onAsk={props.onAsk}
        onAnswerPermission={props.onAnswerPermission}
      />
    ) : null;

  const outdated = entries.filter(
    (e) => e.path === path && !e.parentId && !e.shown && e.state === "outdated",
  );

  return (
    <div
      ref={root}
      data-diff-pending={props.collapsed ? undefined : true}
      tabIndex={-1}
      onContextMenu={(e) => void tokenMenu(e.nativeEvent)}
      className={cn(
        "select-text",
        props.editor && "file-editor-view min-h-0 flex-1 overflow-auto",
        !props.stacked &&
          !props.editor &&
          "mt-[var(--review-content-start)] mb-[var(--review-content-end)] min-h-0 flex-1 overflow-auto",
        !props.stacked && !props.editor && reviewCard,
        !props.stacked && !props.editor && reviewGutter,
      )}
    >
      {!props.editor && (
        <div
          ref={header}
          className={cn(
            "review-file-header sticky z-10 flex min-h-11 items-center gap-3 border bg-white px-4 py-2 text-xs dark:bg-neutral-900",
            props.collapsed ? "rounded-xl" : "rounded-t-xl",
            props.stacked ? "top-[var(--review-top-clearance)]" : "top-0",
            divider,
          )}
          title={
            opened.kind === "diff" && opened.file.previousPath
              ? `${opened.file.previousPath} → ${path}`
              : path
          }
        >
          <ReviewCorners />
          {props.onCollapsedChange && (props.stacked || opened.kind === "diff") && (
            <Button
              variant="ghost"
              className={cn("review-file-disclosure relative shrink-0 p-0", muted)}
              style={{
                marginLeft: -16,
                width: "var(--review-number-gutter, 6ch)",
              }}
              title={props.collapsed ? "Expand file" : "Collapse file"}
              aria-label={props.collapsed ? "Expand file" : "Collapse file"}
              aria-expanded={!props.collapsed}
              onClick={() => {
                disclosureScroll.current?.stop();
                if (header.current) disclosureScroll.current = holdScrollPosition(header.current);
                props.onCollapsedChange?.(
                  path,
                  !props.collapsed,
                  opened.kind === "file" ? "file" : undefined,
                );
              }}
            >
              <svg
                viewBox="0 0 16 16"
                fill="currentColor"
                aria-hidden="true"
                style={{ transform: props.collapsed ? "rotate(-90deg)" : undefined }}
              >
                <path d="M3.47 5.47a.75.75 0 0 1 1.06 0L8 8.94l3.47-3.47a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 0 1 0-1.06" />
              </svg>
            </Button>
          )}
          <span className="min-w-0 flex-1 truncate font-mono">{path}</span>
          {opened.kind === "diff" && (
            <span className="shrink-0 font-mono">
              <span className="text-[var(--sidebar-added-light)] dark:text-green-400">
                +{opened.file.additions}
              </span>{" "}
              <span className="text-[var(--sidebar-deleted-light)] dark:text-red-400">
                −{opened.file.deletions}
              </span>
            </span>
          )}
          {(props.stacked || opened.kind === "diff") && (
            <DiffHeaderActions
              outdated={outdated.length}
              onToggleOutdated={() => setShowOutdated((s) => !s)}
              reviewed={props.reviewed}
              onReviewedChange={(on) =>
                props.onReviewedChange(path, on, opened.kind === "file" ? "file" : undefined)
              }
            />
          )}
        </div>
      )}
      {/* Collapse the entire body, including context spacing and annotations, not only Pierre's code rows. */}
      <div
        hidden={props.collapsed}
        className={
          props.editor
            ? "file-editor-body min-h-full"
            : "review-file-body rounded-b-xl border-x border-b bg-white dark:bg-neutral-900"
        }
      >
        {!props.editor && <ReviewCorners bottom />}
        {(showOutdated || (revealed && !revealed.shown && revealed.state === "outdated")) && (
          <OutdatedThreads entries={outdated} renderThread={(entry) => render({ entry })} />
        )}
        {opened.kind === "file" ? (
          <File<Box>
            file={files.new}
            options={options}
            selectedLines={selection}
            lineAnnotations={annotations.file}
            renderAnnotation={(a) => render(a.metadata)}
          />
        ) : (
          <MultiFileDiff<Box>
            oldFile={files.old}
            newFile={files.new}
            options={options}
            selectedLines={selection}
            lineAnnotations={annotations.diff}
            renderAnnotation={(a) => render(a.metadata)}
          />
        )}
      </div>
    </div>
  );
});

// Above a file diff: its threads about code that has changed since (ADR 0015), each with the code it was about and what
// stands there now.
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
          <Code label="Then">{e.code ?? ""}</Code>
          {e.now !== null && <Code label="Now">{e.now || "(gone)"}</Code>}
          {renderThread(e)}
        </div>
      ))}
    </div>
  );
}

const Code = ({ label, children }: { label: string; children: string }) => (
  <div className="mx-2 mt-1 flex gap-2">
    <span className={cn("w-8 shrink-0 pt-1.5 text-right text-[11px]", muted)}>{label}</span>
    <pre className="min-w-0 flex-1 overflow-x-auto rounded bg-neutral-100 p-1.5 font-mono text-xs dark:bg-neutral-800">
      {children}
    </pre>
  </div>
);

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
      <label className={cn("flex items-center gap-1 font-sans text-xs select-none", muted)}>
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
