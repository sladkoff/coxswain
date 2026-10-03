import { Virtualizer } from "@pierre/diffs/react";
import { match, P } from "ts-pattern";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { type UIEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Commit } from "../../core/git";
import type { PullRequest } from "../../core/github";
import type { NewEntry, ReviewEntry } from "../../core/review";
import type { AttachedPrompt, Prompt, View, ViewRange } from "../../core/views";
import type { Workspace } from "../../core/workspaces";
import { Agents } from "./Agents";
import { FindBar } from "./FindBar";
import { activateFindPane, closeFind, nextFind, openFind } from "./find";
import { upsert } from "./ChatEntry";
import { CanvasBar, PaneBar, type PaneTab, viewTitles } from "./CanvasBar";
import { type Action, CommandPalette } from "./CommandPalette";
import { Commits, Turns } from "./Commits";
import { Button } from "./components/button";
import { Centered, Splitter, viewerMin } from "./components/layout";
import { cn, divider, muted, titleBar } from "./components/styles";
import { Navigator, type NavigatorView } from "./Navigator";
import { NewWorkspace } from "./NewWorkspace";
import { Onboarding } from "./Onboarding";
import { Projects } from "./Projects";
import { defaultViewId, threadLocation, type CanvasSearch } from "./canvas-state";
import { core, markReviewed as mark, queryClient } from "./queries";
import { Settings } from "./Settings";
import { workspaceLabel } from "./format";
import { Setup } from "./Setup";
import { StatusBar } from "./StatusBar";
import { usePullRequest } from "./usePullRequest";
import { SpinnerIcon } from "./components/icons";
import { ProseThreads } from "./ProseThreads";
import { PullRequestPanel } from "./PullRequest";
import { viewDiff, ViewProse, ViewSectionHeader } from "./ViewSection";
import { ViewToc } from "./ViewToc";
import type { ViewSettings } from "../../preload";
import { openedPath, type Opened, type Turn, Viewer } from "./Viewer";
import { WorkspaceRail } from "./WorkspaceRail";

// Stable empty lists: a new [] each render would redraw the memoised Viewers.
const noEntries: ReviewEntry[] = [];
const noPaths: string[] = [];
const noViews: View[] = [];

export function App() {
  const router = useRouter();
  const navigate = useNavigate();
  const location = useLocation();
  const search = useSearch({ from: "__root__" });
  const workspaceLocations = useRef(new Map<number, CanvasSearch>());
  const [screen, setScreen] = useState<
    "main" | "settings" | "new-prompt" | "projects" | "new-workspace"
  >("main");
  const close = () => setScreen("main");

  const setup = useQuery(core("checkSetup"));
  const projects = useQuery(core("listProjects")).data;
  const current = projects?.[0]; // listed most recently opened first
  const selectProject = async (fullName: string) => {
    await window.coxswain.openProject(fullName);
    close();
  };

  // ponytail: pane widths reset on restart; persist them in SQLite once a settings table exists.
  const [leftWidth, setLeftWidth] = useState(416);
  const [agentsWidth, setAgentsWidth] = useState(416);
  // L1, the workspace sidebar: shown until hidden with its button, back with the agent pane's. ponytail: resets on
  // restart, like the pane widths.
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // The pane on the left of the canvas: the Navigator, the commits or the agent turns, under its own bar. Starts hidden; hiding it
  // keeps which one it was, for ⌘B.
  const [paneOpen, setPaneOpen] = useState(false);
  const [pane, setPane] = useState<"navigator" | "commits" | "turns">("navigator");
  const showPane = (p: "navigator" | "commits" | "turns") => {
    setPane(p);
    setPaneOpen(true);
  };

  // ponytail: resets on restart, like the Navigator's settings; store them once there's a settings table.
  const [viewSettings, setViewSettings] = useState<ViewSettings>({
    diffStyle: "unified",
    showReviewed: false,
    layout: "tree",
  });
  const workspaces =
    useQuery({ ...core("listWorkspaces", current?.id ?? 0), enabled: !!current }).data ?? [];
  const latestWorkspace = workspaces.reduce<Workspace | undefined>(
    (latest, w) => (!latest || w.lastOpenedAt > latest.lastOpenedAt ? w : latest),
    undefined,
  );
  const currentWorkspace = workspaces.find((w) => w.id === search.ws) ?? latestWorkspace;
  const selectWorkspace = (id: number) => {
    close();
    return navigate({ to: "/", search: workspaceLocations.current.get(id) ?? { ws: id } });
  };
  const opening = async (open: Promise<Workspace>) => {
    const workspace = await open;
    // In the list at once, so it's selected; the core's change brings the rest.
    queryClient.setQueryData(core("listWorkspaces", workspace.projectId).queryKey, (before = []) =>
      before.some((w) => w.id === workspace.id) ? before : [...before, workspace],
    );
    await selectWorkspace(workspace.id);
  };
  const newPullWorkspace = (p: PullRequest) =>
    current && opening(window.coxswain.openPullRequestWorkspace(current.id, p.number, p.headRef));
  // Rejects with the reason if git won't take the branch's name; the new workspace screen shows it.
  const newBranchWorkspace = async (branch: string, base: string) => {
    if (current) await opening(window.coxswain.openBranchWorkspace(current.id, branch, base));
  };

  // The workspace's entries, reviewed files and agent sessions go with it; its worktree stays on disk.
  const removeWorkspace = async (w: Workspace) => {
    const ok = await window.coxswain.confirm({
      message: `Remove ${workspaceLabel(w)} from the sidebar?`,
      detail: `Its comments, reviewed files and agent sessions are deleted. The worktree stays on disk, and adding the ${w.prNumber !== null ? "PR" : "branch"} again reuses it.`,
      action: "Remove",
    });
    if (!ok) return;
    await window.coxswain.removeWorkspace(w.id);
  };

  // ADR 0008: clone as soon as a project is current; opening a workspace waits for it.
  const [cloning, setCloning] = useState(false);
  useEffect(() => {
    if (!current) return;
    setCloning(true);
    window.coxswain.cloneProject(current.id).finally(() => setCloning(false));
  }, [current?.id]);

  // The router chooses the workspace and canvas together; SQLite only supplies the startup default.
  const s: CanvasSearch =
    search.ws === currentWorkspace?.id
      ? search
      : (workspaceLocations.current.get(currentWorkspace?.id ?? 0) ?? {});
  const shown = useRef(s);
  shown.current = { ...s, ws: currentWorkspace?.id };
  // How the location last changed: a line is scrolled to only when the file is opened, not on Back or Forward.
  const lastAction = useRef("PUSH");
  useEffect(
    () => router.history.subscribe(({ action }) => void (lastAction.current = action.type)),
    [router],
  );
  const moved = lastAction.current !== "PUSH" && lastAction.current !== "REPLACE";
  // A new entry with these changes to what the canvas shows. Stable, so the memoised Viewers don't redraw.
  const show = useCallback(
    (changes: CanvasSearch, replace = false) =>
      navigate({
        to: "/",
        search: { ...shown.current, thread: undefined, pr: undefined, ...changes },
        replace,
      }),
    [navigate],
  );
  const canBack = location.state.__TSR_index > 0;
  const canForward = location.state.__TSR_index < router.history.length - 1;
  useEffect(() => window.coxswain.setNavigation(canBack, canForward), [canBack, canForward]);
  // Initial project load (or removal of the selected workspace) uses its last opened workspace.
  useEffect(() => {
    if (currentWorkspace && search.ws !== currentWorkspace.id)
      void navigate({
        to: "/",
        search: workspaceLocations.current.get(currentWorkspace.id) ?? { ws: currentWorkspace.id },
        replace: true,
      });
  }, [currentWorkspace?.id, search.ws]);
  useEffect(() => {
    if (search.ws === currentWorkspace?.id && search.ws !== undefined)
      workspaceLocations.current.set(search.ws, search);
  }, [search, currentWorkspace?.id]);
  useEffect(() => {
    if (!currentWorkspace) return;
    void window.coxswain.openWorkspace(currentWorkspace.id);
  }, [currentWorkspace?.id]);

  const view: NavigatorView = s.view ?? "diffs";
  const pr = usePullRequest(currentWorkspace);
  // The Commits menu: one commit's diff (its parent to it) in place of all changes. Dropped when the PR's head moves.
  const commit = s.commit ?? null;
  const head = useRef<{ ws: number; head: string } | null>(null);
  useEffect(() => {
    if (!currentWorkspace || !pr.commits) return;
    const was = head.current;
    head.current = { ws: currentWorkspace.id, head: pr.commits.head };
    if (was?.ws === currentWorkspace.id && was.head !== pr.commits.head && shown.current.commit)
      void show({ commit: undefined }, true);
  }, [currentWorkspace?.id, pr.commits]);
  // The view shown on the canvas (ADR 0023, 0026), or none. The newest shows when it appears, and on opening a
  // workspace if it isn't stale. A view and a commit are both a pinned range, so picking one drops the other.
  const viewsQuery = useQuery({
    ...core("listViews", currentWorkspace?.id ?? 0),
    enabled: !!currentWorkspace,
  });
  const views = viewsQuery.data ?? (viewsQuery.isError ? noViews : undefined);
  // On opening a workspace the newest shows in place (unless one was chosen); a new view shows as an entry of its own.
  const viewId = defaultViewId(s, views, pr.snapshot, pr.snapshotReady);
  const newest = useRef<{ workspaceId: number; id: number } | null>(null);
  useEffect(() => {
    if (!currentWorkspace || !views || !pr.commits || !pr.snapshotReady) return;
    const latest = views[0];
    const now = shown.current;
    if (newest.current?.workspaceId !== currentWorkspace.id) {
      if (now.viewId === undefined)
        void show({ viewId: defaultViewId(now, views, pr.snapshot, pr.snapshotReady) }, true);
    } else if (latest && latest.id > newest.current.id)
      void show({ viewId: latest.id, commit: undefined });
    newest.current = { workspaceId: currentWorkspace.id, id: latest?.id ?? 0 };
  }, [currentWorkspace?.id, views, pr.commits, pr.snapshot, pr.snapshotReady]);
  const canvasView = (viewId != null && views?.find((v) => v.id === viewId)) || null;
  // Without either, the diff: all of it, or one of its layers (glossary: scope), which add up to it: what's on GitHub,
  // the commits not pushed yet, and what isn't committed (ADR 0028). Uncommitted is the live worktree, like all of it;
  // the rest are pinned ranges.
  const scope = s.scope ?? "all";
  // HEAD, and whether anything isn't committed on top of it: the Commits pane's Uncommitted changes.
  const uncommitted = useQuery({
    ...core("uncommitted", currentWorkspace?.id ?? 0),
    enabled: !!currentWorkspace && !!pr.commits,
  }).data;
  const committed = uncommitted?.status === "ok" ? uncommitted.head : null;
  // The range the diff shows (null: all of it, live), and what a new view is asked to cover: the commit, turn or scope
  // (null for all of the workspace's changes, also while a view shows). head null: the live worktree.
  const shownRange = match({ commit, canvasView, scope, commits: pr.commits, committed })
    .returnType<{ what: string | null; base: string; head: string | null } | null>()
    .with({ commit: P.nonNullable.select() }, (c) => ({
      what: c.turn
        ? `the agent turn "${c.subject}"`
        : `commit ${c.sha.slice(0, 7)} ("${c.subject}")`,
      base: c.parent,
      head: c.sha,
    }))
    .with({ canvasView: P.nonNullable.select() }, (v) => ({
      what: null,
      base: v.base,
      head: v.head,
    }))
    .with({ scope: "pushed", commits: P.nonNullable.select() }, (c) => ({
      what:
        currentWorkspace?.prNumber != null ? "the PR's changes on GitHub" : "the changes on GitHub",
      base: c.mergeBase,
      head: c.head,
    }))
    .with({ scope: "unpushed", commits: P.nonNullable, committed: P.string }, (r) => ({
      what: "the commits not pushed yet",
      base: r.commits.head,
      head: r.committed,
    }))
    .with({ scope: "uncommitted", committed: P.string.select() }, (head) => ({
      what: "the uncommitted changes",
      base: head,
      head: null,
    }))
    .otherwise(() => null);
  const range = shownRange && { base: shownRange.base, head: shownRange.head ?? undefined };
  const viewRange: ViewRange | null =
    shownRange?.what != null ? { ...shownRange, what: shownRange.what } : null;

  // How much each layer has, for the range menu: commits on GitHub and not pushed, files not committed.
  const allCommits = useQuery({
    ...core("listCommits", currentWorkspace?.id ?? 0, pr.commits?.mergeBase ?? ""),
    enabled: !!currentWorkspace && !!pr.commits,
  }).data;
  const unpushedCommits = useQuery({
    ...core("listCommits", currentWorkspace?.id ?? 0, pr.commits?.head ?? ""),
    enabled: !!currentWorkspace && !!pr.commits,
  }).data;
  const commitCount = (l: typeof allCommits) => (l?.status === "ok" ? l.commits.length : 0);
  const layers = {
    pushed: commitCount(allCommits) - commitCount(unpushedCommits),
    unpushed: commitCount(unpushedCommits),
    uncommitted: uncommitted?.status === "ok" ? (uncommitted.size?.files ?? 0) : 0,
  };

  // The workspace's entries, as the canvas shows them (ADR 0015: current or outdated in the live diff, shown or not in
  // the range picked). An explanation or finding shows only with its view.
  const mergeBase = pr.commits?.mergeBase;
  const base = range?.base ?? mergeBase;
  const entriesQuery = useQuery({
    ...core("listEntries", currentWorkspace?.id ?? 0, mergeBase ?? "", base ?? "", range?.head),
    enabled: !!currentWorkspace && !!base && !!mergeBase,
  });
  const allEntries = entriesQuery.data;
  const entries = useMemo(
    () => allEntries?.filter((e) => !e.viewId || e.viewId === canvasView?.id) ?? noEntries,
    [allEntries, canvasView?.id],
  );
  // Callbacks handed to the Viewers are stable (useCallback), so a memoised Viewer doesn't redraw its file diff.
  // Paths of the reviewed file diffs: the live diff's, reloaded with the changes, since a file diff that changed is no
  // longer reviewed (ADR 0014); or at a view's head, where they stay as they were.
  const reviewedBase = range?.base ?? mergeBase;
  const reviewedQuery = useQuery({
    ...core("listReviewed", currentWorkspace?.id ?? 0, reviewedBase ?? "", range?.head),
    enabled: !!currentWorkspace && !!reviewedBase && !!pr.changed,
  });
  const reviewed = reviewedQuery.data ?? noPaths;
  const reviewedFilesQuery = useQuery({
    ...core("listReviewed", currentWorkspace?.id ?? 0, reviewedBase ?? "", range?.head, "file"),
    enabled: !!currentWorkspace && !!canvasView && !!reviewedBase,
  });
  const reviewedFiles = reviewedFilesQuery.data ?? noPaths;
  const isReviewed = (opened: Opened) =>
    (opened.kind === "file" ? reviewedFiles : reviewed).includes(openedPath(opened));
  // A ticked file diff is hidden unless Show Reviewed Files is on: the next one takes its place on screen, rather than
  // everything below moving up under the scroll. In a view it collapses instead, and its header stays where it was.
  // Show Reviewed Files and the view through refs, so the callback stays stable.
  const showReviewed = useRef(viewSettings.showReviewed);
  showReviewed.current = viewSettings.showReviewed;
  const inView = useRef(!!canvasView);
  inView.current = !!canvasView;
  const markReviewed = useCallback(
    (path: string, on: boolean, kind?: "file") => {
      if (!currentWorkspace || !reviewedBase) return;
      const scroller = canvas.current && canvasScroller(canvas.current);
      const diffs = [...(scroller?.querySelectorAll<HTMLElement>('[id^="diff:"]') ?? [])];
      const i = diffs.findIndex((el) => el.id === `diff:${path}`);
      const next = diffs[i + 1];
      mark(currentWorkspace.id, reviewedBase, path, on, range?.head, kind);
      const anchor = inView.current ? diffs[i] : next;
      if (!on || showReviewed.current || i < 0 || !anchor || !scroller) return;
      const top = scroller.getBoundingClientRect().top;
      const at = Math.max(diffs[i].getBoundingClientRect().top, top);
      reviewScroll.current?.();
      reviewScroll.current = restoreScroll(canvas.current!, {
        top: 0,
        anchor: anchor.id,
        offset: top - at,
      });
    },
    [currentWorkspace?.id, reviewedBase, range?.head],
  );
  // Marks all of a view section's files and file diffs, or unmarks them.
  const markSection = (files: Opened[], on: boolean) => {
    if (!currentWorkspace || !reviewedBase) return;
    for (const d of files.filter((d) => isReviewed(d) !== on))
      mark(
        currentWorkspace.id,
        reviewedBase,
        openedPath(d),
        on,
        range?.head,
        d.kind === "file" ? "file" : undefined,
      );
  };
  // Questions' turns by thread, kept here so they outlive the Viewer showing them. The reply streams in as chat
  // entries; once the turn ends it's an answer entry. A tool use to approve waits in permission until answered.
  const [turns, setTurns] = useState<Record<number, Turn>>({});
  useEffect(() => {
    const offChat = window.coxswain.onQuestionChat((id, c) =>
      setTurns((t) => ({
        ...t,
        [id]: {
          running: true,
          queued: false,
          error: null,
          live: upsert(t[id]?.live ?? [], c),
          permission: t[id]?.permission ?? null,
        },
      })),
    );
    const offQueued = window.coxswain.onQuestionQueued((id) =>
      setTurns((t) => ({
        ...t,
        [id]: { running: true, queued: true, error: null, live: [], permission: null },
      })),
    );
    const offPermission = window.coxswain.onQuestionPermission((id, permission) =>
      setTurns((t) => ({
        ...t,
        [id]: { running: true, queued: false, error: null, live: t[id]?.live ?? [], permission },
      })),
    );
    // The answer entry comes with the core's change event, just before this.
    const offEnd = window.coxswain.onQuestionEnd((id, result) =>
      setTurns((t) => ({
        ...t,
        [id]: {
          running: false,
          queued: false,
          error: result.status === "error" ? result.message : null,
          live: [],
          permission: null,
        },
      })),
    );
    return () => {
      offChat();
      offQueued();
      offPermission();
      offEnd();
    };
  }, []);
  const answerPermission = useCallback((threadId: number, id: string, optionId: string) => {
    window.coxswain.answerPermission(id, optionId);
    setTurns((t) => ({ ...t, [threadId]: { ...t[threadId], permission: null } }));
  }, []);
  // A new question, or a thread sent to the agent (its latest note becomes the question).
  const ask = useCallback(async (q: NewEntry | { workspaceId: number; threadId: number }) => {
    const question =
      "threadId" in q
        ? await window.coxswain.sendThread(q.workspaceId, q.threadId)
        : await window.coxswain.askQuestion(q);
    if (!question) return;
    const id = question.parentId ?? question.id;
    setTurns((t) => ({
      ...t,
      [id]: {
        running: true,
        queued: t[id]?.queued ?? false, // review:queued can come before the question
        error: null,
        live: t[id]?.live ?? [],
        permission: t[id]?.permission ?? null,
      },
    }));
  }, []);
  // `opened` is a whole file picked in Files, shown on the canvas in place of the file diffs. Memoised: the Viewer
  // rereads when its Opened changes.
  const line = moved ? undefined : s.line;
  const opened = useMemo<Opened | null>(
    () => (s.file ? { kind: "file", path: s.file, line, commit: s.fileAt } : null),
    [s.file, line, s.fileAt],
  );
  // Each entry keeps where the canvas was scrolled, restored on Back and Forward. For the file diffs also the one at
  // the top: those above it may have been read (and grown) since, so the offset alone would land elsewhere.
  const canvas = useRef<HTMLDivElement>(null);
  const reviewScroll = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => reviewScroll.current?.(), [location.state.__TSR_key]);
  const scrolls = useRef(new Map<string, Scroll>());
  const workspaceScrolls = useRef(new Map<number, Scroll>());
  const scrollWorkspace = useRef<number | undefined>(undefined);
  const entry = () => router.history.location.state.__TSR_key ?? "";
  // Memoised: the Viewer rereads when its Opened changes.
  const diffs = useMemo(
    () => pr.changed?.map((file) => ({ kind: "diff" as const, file })),
    [pr.changed],
  );
  const rangeList = useQuery({
    ...core("listChangedFiles", currentWorkspace?.id ?? 0, range?.base ?? "", range?.head),
    enabled: !!currentWorkspace && !!range,
  }).data;
  // ponytail: a git error shows as no changes; show it like the Navigator's problems if it happens.
  const rangeChanged = useMemo(
    () => (rangeList ? (rangeList.status === "ok" ? rangeList.files : []) : null),
    [rangeList],
  );
  const diffPr = range ? { ...pr, changed: rangeChanged } : pr;
  const diffDiffs = useMemo(
    () => (range ? rangeChanged?.map((file) => ({ kind: "diff" as const, file })) : diffs),
    [!!range, rangeChanged, diffs],
  );
  // Reviewed file diffs are hidden unless Show Reviewed Files is on, as in the Navigator. In a view they collapse to
  // their header instead, so the prose leading into them still has them under it.
  const isShown = (d: Opened) => viewSettings.showReviewed || !isReviewed(d);
  const shownDiffs = useMemo(
    () => diffDiffs?.filter(isShown),
    [diffDiffs, reviewed, viewSettings.showReviewed],
  );
  // With a view, its sections in order: prose and the file diffs it embeds; for a guide, then the files in none.
  const sections = useMemo(() => {
    if (!canvasView || !diffDiffs) return null;
    const byPath = new Map(diffDiffs.map((d) => [d.file.path, d]));
    // Muted (glossary): a section of only muted embeds is low-lighted whole; its heading says why.
    const section = (title: string | null, parts: SectionPart[], allMuted: boolean) => {
      const files = parts.flatMap((p) => (p.kind === "code" ? [p.d] : []));
      return { title, parts, muted: allMuted, files };
    };
    const listed = new Set<string>();
    const all = canvasView.sections.map((x) => {
      const parts = x.parts.flatMap((p): SectionPart[] => {
        if (p.kind === "prose") return [p];
        const d: Opened | undefined =
          p.kind === "file" ? { kind: "file", path: p.path } : byPath.get(p.path);
        if (!d) return [];
        if (p.kind === "diff") listed.add(p.path);
        return [{ kind: "code", d, muted: p.muted }];
      });
      const embeds = parts.filter((p) => p.kind === "code");
      return section(x.title, parts, embeds.length > 0 && embeds.every((p) => p.muted));
    });
    const rest = diffDiffs.filter((d) => !listed.has(d.file.path));
    if (canvasView.guide && rest.length)
      all.push(
        section(
          null,
          rest.map((d) => ({ kind: "code", d, muted: false })),
          false,
        ),
      );
    return all;
  }, [canvasView, diffDiffs, reviewed, reviewedFiles, viewSettings.showReviewed]);
  const canvasFiles = sections?.flatMap((s) => s.files) ?? diffDiffs ?? [];
  // The table of contents: the section at the top of the canvas's scroll.
  const [currentSection, setCurrentSection] = useState(0);
  const pickSection = (i: number) => document.getElementById(`view-section-${i}`)?.scrollIntoView();
  // The last section whose top has scrolled past the top of the canvas (with a little slack) is the current one. Only
  // the canvas's own scroll: file diffs also scroll sideways inside it.
  const onCanvasScroll = (e: UIEvent<HTMLDivElement>) => {
    const scroller = e.target as HTMLElement;
    if (scroller.parentElement !== e.currentTarget) return;
    const position = scrollOf(scroller);
    scrolls.current.set(entry(), position);
    if (currentWorkspace) workspaceScrolls.current.set(currentWorkspace.id, position);
    if (!sections) return;
    const top = scroller.getBoundingClientRect().top + 40;
    const passed = sections.flatMap((_, i) => {
      const el = document.getElementById(`view-section-${i}`);
      return el && el.getBoundingClientRect().top <= top ? [i] : [];
    });
    setCurrentSection(passed.at(-1) ?? 0);
  };
  // A prompt for the agent pane's composer, from the new view menu; a new object each time, so the same one attaches
  // again. The user sends it from the agent pane; the view shows as soon as the agent starts it.
  const [composerPrompt, setComposerPrompt] = useState<{
    prompt: AttachedPrompt;
    workspaceId: number;
  }>();
  const prompts = useQuery(core("listPrompts")).data ?? [];
  // Its explanations and findings go with it; showing it, the canvas falls back to the diff.
  const removeView = async (v: View, label: string) => {
    const ok = await window.coxswain.confirm({
      message: `Remove the view “${label}”?`,
      detail: "Its sections, explanations and findings are deleted.",
      action: "Remove",
    });
    if (!ok) return;
    await window.coxswain.removeView(v.id);
  };
  const newView = async () => {
    const picked = await window.coxswain.showNewViewMenu(viewRange);
    if (picked === "new-prompt") setScreen("new-prompt");
    else setComposerPrompt({ prompt: picked, workspaceId: currentWorkspace!.id });
  };
  const showView = (id: number | null) =>
    void show({ viewId: id, commit: undefined, file: undefined, fileAt: undefined, at: undefined });
  const pickCommit = (picked: Commit | null) =>
    void show({
      commit: picked ?? undefined,
      viewId: null,
      file: undefined,
      fileAt: undefined,
      at: undefined,
    });
  // The pane's bar: Changes and Files are the Navigator's toggle (a history entry, ADR 0025), Commits and Turns other
  // panes.
  const paneTab: PaneTab = pane === "navigator" ? view : pane;
  const pickPaneTab = (t: PaneTab) => {
    setPane(t === "commits" || t === "turns" ? t : "navigator");
    if ((t === "diffs" || t === "files") && t !== view)
      void show({ view: t === "files" ? "files" : undefined });
  };
  const pickScope = (picked: "all" | "pushed" | "unpushed" | "uncommitted") =>
    void show({
      scope: picked === "all" ? undefined : picked,
      commit: undefined,
      viewId: null,
      file: undefined,
      at: undefined,
    });
  // Push and Open Pull Request… (ADR 0028) go to GitHub, so they ask first. What went wrong shows in the Commits pane.
  const [gitProblem, setGitProblem] = useState<string | null>(null);
  const pushed = async (w: Workspace, result: { status: string; message?: string }) => {
    setGitProblem(result.status === "ok" ? null : (result.message ?? `GitHub: ${result.status}`));
  };
  const push = async (w: Workspace) => {
    const ok = await window.coxswain.confirm({
      message: `Push ${w.branch ? `“${w.branch}”` : "the PR's branch"} to GitHub?`,
      detail: "Its commits that aren't pushed yet go to GitHub. Uncommitted changes stay here.",
      action: "Push",
    });
    if (ok) await pushed(w, await window.coxswain.push(w.id));
  };
  const openPullRequest = async (w: Workspace) => {
    const ok = await window.coxswain.confirm({
      message: `Open a pull request for “${w.branch}” into “${w.baseBranch}”?`,
      detail:
        "Pushes the branch to GitHub and opens a draft pull request, then shows it in your browser to finish its title and description. Uncommitted changes aren't in it.",
      action: "Open Pull Request",
    });
    if (ok) await pushed(w, await window.coxswain.openPullRequest(w.id));
  };
  // The one way to show a whole file: on the canvas, at `line` if given, with the Navigator on Files and the file
  // revealed there. Files, Open Quickly, Go to Definition and Find Usages all go through it. Stable, so the memoised
  // Viewers don't all redraw.
  const openFile = useCallback(
    (path: string, line?: number, commit?: string) => {
      showPane("navigator");
      // The same file again without a line (e.g. the tree selecting the one it revealed) is no new entry.
      const now = shown.current;
      if (!line && now.view === "files" && now.file === path) return;
      void show({ view: "files", file: path, line, fileAt: commit, at: undefined });
    },
    [show],
  );
  // An entry of its own, though the canvas still shows the file diffs.
  const open = async (path: string) => {
    if (view === "files") return openFile(path);
    await show({ at: path });
    // ponytail: file diffs above it that are still loading push it down.
    document.getElementById(`diff:${path}`)?.scrollIntoView();
  };
  const showFile = view === "files" && opened;
  // The command palette, with its first query while it's open: ">" for actions (⌘K), "" for files (Open Quickly, ⌘⇧O).
  // A file picked is shown on the canvas with the Navigator on Files.
  const [palette, setPalette] = useState<string | null>(null);
  const openQuickly = (path: string) => {
    setPalette(null);
    openFile(path);
  };
  // Revealing a thread must happen before its file/section can mount. Preserve its Reviewed mark.
  // Bumped by each thread picked: picking the one shown again leaves the location as it is, but should scroll again.
  const [threadPicks, setThreadPicks] = useState(0);
  const viewThread = async (threadId: number) => {
    let root = allEntries?.find((e) => e.id === threadId);
    // A chat card can refer to a thread outside the currently filtered view.
    if (!root && currentWorkspace && pr.commits) {
      const all = await queryClient.fetchQuery(
        core("listEntries", currentWorkspace.id, pr.commits.mergeBase, pr.commits.mergeBase),
      );
      root = all.find((e) => e.id === threadId);
    }
    if ((!root?.path && root?.section == null) || root.workspaceId !== shown.current.ws) return;
    setViewSettings((settings) => ({ ...settings, showReviewed: true }));
    // Already on the canvas (its file shows and its lines are there, e.g. a note written in the view shown): scroll to
    // it in place rather than leave for the range it was written in.
    const here = entries.find((e) => e.id === threadId);
    if (root.section != null && !showFile && canvasView?.id === root.viewId)
      await show({ thread: threadId });
    else if (here?.shown && !showFile && canvasFiles.some((f) => openedPath(f) === root.path))
      await show({ thread: threadId, at: root.path! });
    else await show(threadLocation(root));
    setThreadPicks((n) => n + 1);
  };
  const canvasReady =
    viewId !== undefined &&
    (viewId === null || !!views) &&
    !!pr.commits &&
    !!diffDiffs &&
    !!shownDiffs &&
    (entriesQuery.data !== undefined || entriesQuery.isError) &&
    (reviewedQuery.data !== undefined || reviewedQuery.isError) &&
    (!canvasView || reviewedFilesQuery.data !== undefined || reviewedFilesQuery.isError);
  // Restore only the destination's scroll. Retries from an old navigation must never move a new canvas.
  useEffect(() => {
    if (!canvasReady || !canvas.current || !currentWorkspace) return;
    const switched = scrollWorkspace.current !== currentWorkspace.id;
    scrollWorkspace.current = currentWorkspace.id;
    const saved = moved
      ? scrolls.current.get(location.state.__TSR_key ?? "")
      : switched
        ? workspaceScrolls.current.get(currentWorkspace.id)
        : undefined;
    if (s.thread) return; // thread navigation owns the scroll
    if (saved) return restoreScroll(canvas.current, saved);
    if (switched) {
      const scroller = canvasScroller(canvas.current);
      if (scroller) scroller.scrollTop = 0;
    }
  }, [location.state.__TSR_key, currentWorkspace?.id, canvasReady]);
  // What holds the thread: its file diff, or on a view's prose its section (ADR 0036).
  const threadSection = allEntries?.find((e) => e.id === s.thread)?.section;
  const threadIn = match({ at: s.at, section: threadSection })
    .with({ at: P.string.select() }, (at) => `diff:${at}`)
    .with({ section: P.number.select() }, (section) => `view-section-${section}`)
    .otherwise(() => null);
  useEffect(() => {
    if (!s.thread || !threadIn || !canvasReady || !canvas.current) return;
    return scrollToThread(canvas.current, threadIn, s.thread);
  }, [location.state.__TSR_key, s.thread, threadIn, canvasReady, threadPicks]);

  // The action registry (ADR 0027): everything the command palette lists and the native menu runs, by id. Rebuilt each
  // render, so each action's enabled and run see the current state.
  const onMain = screen === "main" && !!current && palette === null;
  const ready = !!currentWorkspace && !!pr.commits;
  const titles = viewTitles(views ?? []);
  const newViewAction = (p: Prompt | null, id: string, title: string): Action => ({
    id: `new-view:${id}`,
    title,
    enabled: ready,
    run: async () =>
      setComposerPrompt({
        prompt: await window.coxswain.attachPrompt(p, viewRange),
        workspaceId: currentWorkspace!.id,
      }),
  });
  useEffect(() => {
    closeFind(false);
  }, [currentWorkspace?.id, viewId, showFile, range?.base, range?.head, screen]);
  const actions: Action[] = [
    {
      id: "show-pull-request",
      title: "Show Pull Request",
      enabled: onMain && !!pr.details,
      run: () => void show({ pr: true }),
    },
    {
      id: "find",
      title: "Find…",
      shortcut: "⌘F",
      enabled: screen === "main" && !!currentWorkspace,
      run: openFind,
    },
    {
      id: "find-next",
      title: "Find Next",
      shortcut: "⌘G",
      enabled: screen === "main" && !!currentWorkspace,
      run: () => nextFind(),
    },
    {
      id: "find-previous",
      title: "Find Previous",
      shortcut: "⇧⌘G",
      enabled: screen === "main" && !!currentWorkspace,
      run: () => nextFind(true),
    },
    {
      id: "command-palette",
      title: "Command Palette",
      shortcut: "⌘K",
      enabled: onMain,
      run: () => setPalette(">"),
    },
    {
      id: "open-quickly",
      title: "Open Quickly…",
      shortcut: "⌘⇧O",
      enabled: onMain,
      run: () => setPalette(""),
    },
    {
      id: "back",
      title: "Back",
      shortcut: "⌥⌘←",
      enabled: canBack,
      run: () => router.history.back(),
    },
    {
      id: "forward",
      title: "Forward",
      shortcut: "⌥⌘→",
      enabled: canForward,
      run: () => router.history.forward(),
    },
    {
      id: "toggle-navigator",
      title: "Show or Hide the Navigator",
      shortcut: "⌘B",
      enabled: !!currentWorkspace,
      run: () => setPaneOpen((o) => !o),
    },
    {
      id: "toggle-sidebar",
      title: "Show or Hide the Sidebar",
      enabled: true,
      run: () => setSidebarOpen((o) => !o),
    },
    {
      id: "toggle-commits",
      title: "Show or Hide Commits",
      enabled: ready,
      run: () => (paneOpen && pane === "commits" ? setPaneOpen(false) : showPane("commits")),
    },
    {
      id: "toggle-turns",
      title: "Show or Hide Agent Turns",
      enabled: ready,
      run: () => (paneOpen && pane === "turns" ? setPaneOpen(false) : showPane("turns")),
    },
    {
      id: "show-diff",
      title: "Show the Diff Without a View",
      enabled: ready && !!canvasView,
      run: () => showView(null),
    },
    ...(views ?? []).map((v) => ({
      id: `show-view:${v.id}`,
      title: `Show View: ${titles.get(v.id)}`,
      enabled: ready && v.id !== canvasView?.id,
      run: () => showView(v.id),
    })),
    ...(
      [
        ["all", "Show All Changes"],
        [
          "pushed",
          currentWorkspace?.prNumber !== null
            ? "Show Only the PR's Changes"
            : "Show Only What's on GitHub",
        ],
        ["unpushed", "Show Only the Commits Not Pushed"],
        ["uncommitted", "Show Only Uncommitted Changes"],
      ] as const
    ).map(([value, title]) => ({
      id: `scope:${value}`,
      title,
      enabled: ready && (scope !== value || !!range),
      run: () => pickScope(value),
    })),
    {
      id: "push",
      title: "Push",
      enabled: ready && currentWorkspace.prNumber !== null,
      run: () => void push(currentWorkspace!),
    },
    {
      id: "open-pull-request",
      title: "Open Pull Request…",
      enabled: ready && currentWorkspace.prNumber === null,
      run: () => void openPullRequest(currentWorkspace!),
    },
    ...prompts.map((p) =>
      newViewAction(p, p.id === null ? p.title : String(p.id), `New View (${p.title})`),
    ),
    newViewAction(null, "custom", "New View…"),
    {
      id: "diff-unified",
      title: "Unified Diffs",
      enabled: viewSettings.diffStyle !== "unified",
      run: () => setViewSettings((v) => ({ ...v, diffStyle: "unified" })),
    },
    {
      id: "diff-split",
      title: "Split Diffs",
      enabled: viewSettings.diffStyle !== "split",
      run: () => setViewSettings((v) => ({ ...v, diffStyle: "split" })),
    },
    {
      id: "toggle-reviewed",
      title: viewSettings.showReviewed ? "Hide Reviewed Files" : "Show Reviewed Files",
      run: () => setViewSettings((v) => ({ ...v, showReviewed: !v.showReviewed })),
    },
    ...workspaces.map((w) => ({
      id: `workspace:${w.id}`,
      title: `Open Workspace: ${workspaceLabel(w)}`,
      enabled: w.id !== currentWorkspace?.id,
      run: () => void selectWorkspace(w.id),
    })),
    {
      id: "new-workspace",
      title: "New Workspace…",
      enabled: !!current,
      run: () => setScreen("new-workspace"),
    },
    ...(projects ?? []).map((p) => ({
      id: `project:${p.id}`,
      title: `Switch to Project: ${p.owner}/${p.name}`,
      enabled: p.id !== current?.id,
      run: () => void selectProject(`${p.owner}/${p.name}`),
    })),
    { id: "add-project", title: "Add Project…", run: () => setScreen("projects") },
    { id: "settings", title: "Settings…", shortcut: "⌘,", run: () => setScreen("settings") },
  ];
  const latestActions = useRef(actions);
  latestActions.current = actions;
  const run = (id: string) => {
    const action = latestActions.current.find((a) => a.id === id);
    if (action && action.enabled !== false) action.run();
  };
  useEffect(() => window.coxswain.onAction(run), []);

  const viewerProps = (workspace: Workspace, mergeBase: string, head?: string) => ({
    workspace,
    mergeBase,
    head,
    entries,
    onReviewedChange: markReviewed,
    turns,
    onAsk: ask,
    onAnswerPermission: answerPermission,
    onOpenFile: openFile,
    diffStyle: viewSettings.diffStyle,
    revealThread: s.thread,
  });

  if (!setup.data) return null; // local and quick, like the projects below
  if (setup.data.problems.length)
    return <Setup check={setup.data} onRetry={() => void setup.refetch()} />;
  if (screen === "settings" || screen === "new-prompt")
    return (
      <Settings
        onClose={close}
        workspaceId={currentWorkspace?.id}
        newPrompt={screen === "new-prompt"}
      />
    );
  // Projects and New workspace are dialogs over the screen below them.
  const dialog =
    screen === "projects" ? (
      <Projects
        projects={projects ?? []}
        current={current}
        onSelect={selectProject}
        onClose={close}
      />
    ) : screen === "new-workspace" && current ? (
      <NewWorkspace
        project={current}
        openPrNumbers={workspaces.flatMap((w) => (w.prNumber !== null ? [w.prNumber] : []))}
        openBranches={workspaces.flatMap((w) => (w.branch ? [w.branch] : []))}
        onSelect={newPullWorkspace}
        onBranch={newBranchWorkspace}
        onClose={close}
      />
    ) : null;
  if (!projects) return null; // local and near-instant, so no loading screen
  if (!current)
    return (
      <>
        <Onboarding
          onSettings={() => setScreen("settings")}
          onChooseProject={() => setScreen("projects")}
        />
        {dialog}
      </>
    );

  // Empty shell of the main screen from docs/UX.md: L1 project and workspaces, the agent pane, the canvas.
  return (
    // Side panes keep their dragged width but shrink with the window before the Viewer goes below viewerMin.
    <div className="flex h-full select-none overflow-hidden text-sm">
      {dialog}
      {sidebarOpen && (
        <WorkspaceRail
          project={current}
          cloning={cloning}
          workspaces={workspaces}
          current={currentWorkspace}
          onProjects={async () => {
            const picked = await window.coxswain.showProjectsMenu(
              projects.map((p) => `${p.owner}/${p.name}`),
            );
            if (picked === null) setScreen("projects");
            else if (picked !== `${current.owner}/${current.name}`) await selectProject(picked);
          }}
          onSelect={(w) => void selectWorkspace(w.id)}
          onRemove={removeWorkspace}
          onNew={() => setScreen("new-workspace")}
          onHide={() => setSidebarOpen(false)}
        />
      )}

      {palette !== null && (
        <CommandPalette
          workspaceId={currentWorkspace?.id}
          actions={actions}
          initialQuery={palette}
          onOpen={openQuickly}
          onClose={() => setPalette(null)}
        />
      )}
      {currentWorkspace && (
        <>
          {/* The agent pane, always shown for a workspace. */}
          <div
            onPointerDownCapture={() => activateFindPane("chat")}
            onFocusCapture={() => activateFindPane("chat")}
            style={{ width: agentsWidth }}
            className={cn("flex min-w-60 flex-col border-r", divider)}
          >
            <Agents
              key={currentWorkspace.id}
              workspace={currentWorkspace}
              onViewThread={viewThread}
              composerPrompt={
                composerPrompt?.workspaceId === currentWorkspace.id ? composerPrompt : undefined
              }
              onShowSidebar={sidebarOpen ? undefined : () => setSidebarOpen(true)}
            />
          </div>
          <Splitter min={240} max={800} onResize={setAgentsWidth} />
        </>
      )}

      {/* The canvas: what the agent and the human look at together. For now, the workspace's file diffs. */}
      <div
        style={{ minWidth: viewerMin }}
        className="flex min-w-0 flex-1 flex-col"
        onPointerDownCapture={() => activateFindPane("canvas")}
        onFocusCapture={() => activateFindPane("canvas")}
      >
        {!currentWorkspace ? (
          <>
            <div className={cn(titleBar, "border-b", divider)} />
            <Centered>No workspace. Start one with +</Centered>
          </>
        ) : (
          <div className="flex min-h-0 flex-1">
            {paneOpen && (
              <>
                <div
                  style={{ width: leftWidth }}
                  className={cn("flex min-w-60 flex-col border-r", divider)}
                >
                  <PaneBar
                    tab={paneTab}
                    files={diffPr.changed?.length}
                    ready={!!pr.commits}
                    onTab={pickPaneTab}
                    onHide={() => setPaneOpen(false)}
                  />
                  {paneTab === "turns" ? (
                    <Turns workspaceId={currentWorkspace.id} current={commit} onPick={pickCommit} />
                  ) : paneTab === "commits" ? (
                    pr.commits && (
                      <Commits
                        workspaceId={currentWorkspace.id}
                        mergeBase={pr.commits.mergeBase}
                        head={pr.commits.head}
                        canOpenPr={currentWorkspace.prNumber === null}
                        problem={gitProblem}
                        current={commit}
                        onPick={pickCommit}
                        uncommitted={uncommitted?.status === "ok" ? uncommitted.size : null}
                        uncommittedOn={!commit && !canvasView && scope === "uncommitted"}
                        onPickUncommitted={() => pickScope("uncommitted")}
                        onPush={() => void push(currentWorkspace)}
                        onOpenPullRequest={() => void openPullRequest(currentWorkspace)}
                        checks={pr.details?.commitChecks ?? {}}
                      />
                    )
                  ) : (
                    <Navigator
                      key={currentWorkspace.id}
                      workspace={currentWorkspace}
                      pr={diffPr}
                      view={view}
                      layout={viewSettings.layout}
                      reviewed={reviewed}
                      showReviewed={viewSettings.showReviewed}
                      entries={entries}
                      local={range ? undefined : (pr.local ?? undefined)}
                      selected={opened?.kind === "file" ? opened.path : undefined}
                      onOpen={open}
                    />
                  )}
                </div>
                <Splitter min={240} max={720} onResize={setLeftWidth} />
              </>
            )}
            <div className="flex min-w-0 flex-1 flex-col">
              <CanvasBar
                workspaceId={currentWorkspace.id}
                paneOpen={paneOpen}
                onShowPane={() => setPaneOpen(true)}
                ready={!!pr.commits}
                commit={commit}
                view={canvasView}
                views={views ?? []}
                snapshot={pr.snapshot}
                scope={scope}
                hasPr={currentWorkspace.prNumber !== null}
                pr={pr.details}
                onPr={!!s.pr}
                onShowPr={() => void show({ pr: true })}
                onRangeMenu={async () => {
                  const picked = await window.coxswain.showRangeMenu(
                    commit ? null : scope,
                    currentWorkspace.prNumber !== null,
                    layers,
                  );
                  if (picked === "commits" || picked === "turns") showPane(picked);
                  else pickScope(picked);
                }}
                onClearCommit={() => pickCommit(null)}
                onShowView={showView}
                onRemoveView={removeView}
                onNewView={newView}
                onOpenQuickly={() => run("open-quickly")}
                canBack={canBack}
                canForward={canForward}
                onBack={() => run("back")}
                onForward={() => run("forward")}
                onSettings={() => setScreen("settings")}
                onViewOptions={async () =>
                  setViewSettings(await window.coxswain.showViewMenu(viewSettings))
                }
              />
              <FindBar pane="canvas" />
              {s.pr ? (
                pr.details ? (
                  <PullRequestPanel
                    key={currentWorkspace.id}
                    workspaceId={currentWorkspace.id}
                    pr={pr.details}
                  />
                ) : (
                  <Centered>Loading the pull request…</Centered>
                )
              ) : (
                <div className="flex min-h-0 flex-1">
                  {sections && !showFile && (
                    <ViewToc
                      sections={sections}
                      reviewed={reviewed}
                      reviewedFiles={reviewedFiles}
                      entries={entries}
                      current={currentSection}
                      writing={!!canvasView?.writing}
                      onPick={pickSection}
                    />
                  )}
                  <div
                    style={{ minWidth: viewerMin }}
                    className="flex min-w-0 flex-1 flex-col"
                    ref={canvas}
                    onScrollCapture={onCanvasScroll}
                  >
                    {!canvasReady ? (
                      <Centered>Loading…</Centered>
                    ) : (
                      <>
                        {showFile && (
                          // One Viewer per file: a reused one would scroll to a line in the file it drew before.
                          <Viewer
                            key={`${currentWorkspace.id}:${openedPath(opened)}:${s.fileAt ?? "live"}`}
                            opened={opened}
                            reviewed={false}
                            {...viewerProps(currentWorkspace, pr.commits!.mergeBase, s.fileAt)}
                          />
                        )}
                        {canvasView?.writing && !showFile && <WritingViewNotice />}
                        {canvasView?.worktree &&
                          pr.snapshot &&
                          canvasView.head !== pr.snapshot &&
                          !showFile && (
                            <StaleViewNotice
                              onUpdate={async () =>
                                setComposerPrompt({
                                  prompt: await window.coxswain.updateViewPrompt(canvasView),
                                  workspaceId: currentWorkspace.id,
                                })
                              }
                            />
                          )}
                        {/* Only the lines on screen are drawn. Hidden, not unmounted, under a whole file: it keeps its
                      scroll and read files for Back. ponytail: every file is still read from disk up front. */}
                        <Virtualizer
                          key={`${currentWorkspace.id}:${viewId ?? "diff"}:${range?.base ?? pr.commits?.mergeBase}:${range?.head ?? "live"}`}
                          className={cn("min-h-0 flex-1 overflow-auto", showFile && "hidden")}
                        >
                          {canvasView &&
                          !canvasView.sections.length &&
                          (!canvasView.guide || !diffDiffs.length) ? (
                            <div className={cn("p-4 text-xs", muted)}>
                              Nothing in this view yet.
                            </div>
                          ) : (
                            !canvasView &&
                            canvasFiles.every((file) => !isShown(file)) && (
                              <div className={cn("p-4 text-xs", muted)}>
                                {canvasFiles.length ? (
                                  <>
                                    All {canvasFiles.length} files reviewed.{" "}
                                    <Button
                                      variant="link"
                                      onClick={() =>
                                        setViewSettings((s) => ({ ...s, showReviewed: true }))
                                      }
                                    >
                                      Show them
                                    </Button>
                                  </>
                                ) : (
                                  "No changes"
                                )}
                              </div>
                            )
                          )}
                          {(
                            sections ?? [
                              {
                                title: undefined,
                                muted: false,
                                files: diffDiffs,
                                parts: shownDiffs.map((d) => ({ kind: "code", d, muted: false })),
                              },
                            ]
                          ).map((x, i) => (
                            <section
                              key={i}
                              id={`view-section-${i}`}
                              className={cn(
                                x.muted && "opacity-60",
                                // A view's sections: a line between them, room at the end.
                                x.title !== undefined && "border-t pb-4 first:border-t-0",
                                divider,
                              )}
                            >
                              {x.title !== undefined && (
                                <ViewSectionHeader
                                  title={x.title}
                                  files={x.files.length}
                                  reviewed={x.files.filter(isReviewed).length}
                                  writing={!!canvasView?.writing}
                                  onReviewedChange={(on) => markSection(x.files, on)}
                                />
                              )}
                              <ProseThreads
                                workspaceId={currentWorkspace.id}
                                viewId={canvasView?.id ?? 0}
                                section={i}
                                entries={entries}
                                turns={turns}
                                onAsk={ask}
                                onAnswerPermission={answerPermission}
                              >
                                {(x.parts as SectionPart[]).map((p, j) =>
                                  p.kind === "prose" ? (
                                    <ViewProse
                                      key={j}
                                      part={j}
                                      after={(x.parts as SectionPart[])[j - 1]?.kind === "code"}
                                    >
                                      {p.text}
                                    </ViewProse>
                                  ) : (
                                    <div
                                      key={openedPath(p.d)}
                                      id={`diff:${openedPath(p.d)}`}
                                      className={cn(
                                        p.muted && !x.muted && "opacity-60",
                                        x.title !== undefined && viewDiff,
                                      )}
                                    >
                                      <Viewer
                                        stacked
                                        opened={p.d}
                                        reviewed={isReviewed(p.d)}
                                        collapsed={!isShown(p.d)}
                                        {...viewerProps(
                                          currentWorkspace,
                                          range?.base ?? pr.commits!.mergeBase,
                                          range?.head,
                                        )}
                                      />
                                    </div>
                                  ),
                                )}
                              </ProseThreads>
                            </section>
                          ))}
                        </Virtualizer>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        {currentWorkspace && diffPr.changed && (
          <StatusBar
            workspaceId={currentWorkspace.id}
            entries={entries}
            files={
              sections
                ? canvasFiles.map((d) => (d.kind === "diff" ? d.file : { path: d.path }))
                : diffPr.changed
            }
            reviewed={sections ? canvasFiles.filter(isReviewed).map(openedPath) : reviewed}
            turns={turns}
            onViewThread={viewThread}
            viewTitle={canvasView?.title}
            pr={pr.details}
          />
        )}
      </div>
    </div>
  );
}

// A part of a view section on the canvas: its markdown, or a source file or file diff it embeds.
type SectionPart = { kind: "prose"; text: string } | { kind: "code"; d: Opened; muted: boolean };

const canvasScroller = (canvas: HTMLElement) =>
  canvas.querySelector<HTMLElement>(":scope > .overflow-auto:not(.hidden)");

// Where the canvas is scrolled: its offset, and the file diff at its top with how far it is scrolled past.
type Scroll = { top: number; anchor?: string; offset: number };
function scrollOf(scroller: HTMLElement): Scroll {
  const box = scroller.getBoundingClientRect();
  const el = document
    .elementFromPoint(box.left + box.width / 2, box.top + 1)
    ?.closest<HTMLElement>('[id^="diff:"]');
  return el
    ? { top: scroller.scrollTop, anchor: el.id, offset: box.top - el.getBoundingClientRect().top }
    : { top: scroller.scrollTop, offset: 0 };
}

// Scrolls the canvas back once what it shows has drawn: the file diff at the top is there, or the file is long enough.
// Then again until it holds: after a jump, the file diffs' Virtualizer applies the fix-up it worked out for the old
// place (keeping that file diff steady while those around it are drawn). ponytail: gives up after 2 s, e.g. a huge
// file still loading, and leaves it as far as it got.
function restoreScroll(canvas: HTMLElement, s: Scroll) {
  let tries = 40;
  let timer: ReturnType<typeof setTimeout>;
  const later = () => {
    timer = setTimeout(go, 50);
  };
  const go = () => {
    const scroller = canvasScroller(canvas);
    const el = s.anchor ? document.getElementById(s.anchor) : null;
    const ready = s.anchor
      ? el
      : scroller && scroller.scrollHeight - scroller.clientHeight >= s.top;
    if (!ready && tries-- > 0) return void later();
    if (!scroller) return;
    const by = el
      ? el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + s.offset
      : s.top - scroller.scrollTop;
    if (Math.abs(by) < 2) return;
    scroller.scrollTop += by;
    if (tries-- > 0) later();
  };
  timer = setTimeout(go);
  return () => clearTimeout(timer);
}

// Stale (ADR 0023, 0028): the worktree moved on since the view was made, by new commits or local changes. The view
// stays as it was. Above the view, not in its scroll, so it stays in sight. Update View attaches a request to make it
// again to the agent pane's composer, as New View does.
function StaleViewNotice({ onUpdate }: { onUpdate: () => void }) {
  return (
    <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-1 text-xs dark:border-amber-900 dark:bg-amber-950">
      <span className="flex-1">
        The code has changed since this view. It still shows the changes as they were.
      </span>
      <Button className="py-0.5" onClick={onUpdate}>
        Update View
      </Button>
    </div>
  );
}

// Being written (glossary): a turn that changed the view still runs, so more may come. Above the view, not in its
// scroll, so it stays in sight.
function WritingViewNotice() {
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b bg-neutral-50 px-4 py-1.5 text-xs dark:bg-neutral-900",
        divider,
        muted,
      )}
    >
      <SpinnerIcon />
      The agent is still writing this view. Read on; more may come.
    </div>
  );
}

// Scrolls to a thread once it's drawn. The file diffs' Virtualizer draws only the lines near the viewport, so a thread
// further away isn't there yet: go to its file (or view section), page down it until the thread is drawn, then keep it in place until it
// holds (after a jump the Virtualizer applies a fix-up worked out for the old place, as in restoreScroll). Waits for the
// file while it loads; stops when the user scrolls, and is cancelled on navigation. ponytail: a screen per step, about
// a second per thousand lines of a long file; ask the library for the line's position if that's too slow.
function scrollToThread(canvas: HTMLElement, containerId: string, threadId: number) {
  let timer: ReturnType<typeof setTimeout>;
  let steps = 200;
  let held = 0;
  const events = ["wheel", "keydown", "pointerdown"] as const;
  const stop = () => {
    clearTimeout(timer);
    events.forEach((e) => canvas.removeEventListener(e, stop));
  };
  const go = () => {
    timer = setTimeout(go, 50);
    const scroller = canvasScroller(canvas);
    const file = document.getElementById(containerId);
    if (!scroller || !file || !canvas.contains(file)) return;
    if (steps-- <= 0) return stop();
    const view = scroller.getBoundingClientRect();
    // The library keeps a thread's element while its lines aren't drawn, but without a box.
    const thread = document.getElementById(`thread:${threadId}`);
    if (thread && canvas.contains(thread) && thread.getClientRects().length) {
      // Centred, or its top a little below the canvas's when it's taller than the canvas.
      const box = thread.getBoundingClientRect();
      const by =
        box.height > view.height - 80
          ? box.top - view.top - 40
          : box.top + box.height / 2 - (view.top + view.height / 2);
      if (Math.abs(by) < 2) return void (++held >= 4 && stop());
      held = 0;
      scroller.scrollTop += by;
      return;
    }
    // At its top (give or take a pixel, which scrollTop rounds away) or past it: page down.
    const f = file.getBoundingClientRect();
    scroller.scrollTop +=
      f.top > view.top + 2 || f.bottom < view.top
        ? f.top - view.top
        : Math.min(view.height * 0.8, Math.max(0, f.bottom - view.bottom));
  };
  events.forEach((e) => canvas.addEventListener(e, stop));
  timer = setTimeout(go);
  return stop;
}
