import { PreserveReviewScroll } from "./components/PreserveReviewScroll";
import { reviewSourceDestination, type ReviewSurface } from "./source-destination";
import { scrollToThread } from "./components/scroll-to-thread";
import { useUiPreferences } from "./ui-preferences";
import { setAgentPane } from "./agent-pane";
import { fileCountLabel } from "./remaining-files";
import { createGuideReadingPosition } from "./guide-reading-position";
import { orderChanges } from "./changes-order";
import { Virtualizer } from "@pierre/diffs/react";
import { match, P } from "ts-pattern";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import {
  type UIEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Commit } from "../../core/git";
import type { PullRequest } from "../../core/github";
import type { NewEntry, ReviewEntry } from "../../core/review";
import type { View } from "../../core/views";
import type { Workspace } from "../../core/workspaces";
import type { GuideOverride } from "../../core/guides";
import { GuideRunOptions } from "./components/GuideRunOptions";
import { Agents } from "./Agents";
import { FindBar } from "./FindBar";
import { activateFindPane, closeFind, nextFind, openFind } from "./find";
import { upsert } from "./ChatEntry";
import { HistoryBar, type HistoryTab, PaneBar, type PaneTab } from "./CanvasBar";
import { type Action, CommandPalette } from "./CommandPalette";
import { Commits, Turns } from "./Commits";
import { Button } from "./components/button";
import { NativeToolbar, useNativeOcclusion } from "./components/NativeToolbar";
import { TextArea } from "./components/field";
import {
  canvasElement,
  canvasScroller,
  restoreScroll,
  type Scroll,
} from "./components/restore-scroll";
import { ErrorText } from "./components/text";
import {
  Centered,
  Dialog,
  DialogBody,
  DialogFooter,
  Splitter,
  viewerMin,
} from "./components/layout";
import { cn, divider, muted, reviewCard, reviewGutter } from "./components/styles";
import { prepareGuide } from "./prepare-guide";
import { RetainedCanvas } from "./components/RetainedCanvas";
import { RetainedNavigator } from "./Navigator";
import { botLogin } from "../../shared/guide-authors";
import { Sections } from "./Sections";
import { NewWorkspace } from "./NewWorkspace";
import { Onboarding } from "./Onboarding";
import { Projects } from "./Projects";
import { defaultViewId, threadLocation, type CanvasSearch } from "./canvas-state";
import { core, markReviewed as mark, queryClient } from "./queries";
import { Settings } from "./Settings";
import { isComment, projectLabel, workspaceLabel, threadAuthor } from "./format";
import { Setup } from "./Setup";
import { SubmitReviewDialog } from "./SubmitReview";
import { usePullRequest } from "./usePullRequest";
import { SpinnerIcon } from "./components/icons";
import { ProseThreads } from "./ProseThreads";
import { PullRequestPanel } from "./PullRequest";
import { ViewProse, ViewSectionHeader } from "./ViewSection";
import { GuideExplanation } from "./components/GuideExplanation";
import { openedPath, type Opened, type Turn, Viewer } from "./Viewer";
import { WorkspaceTabs } from "./WorkspaceTabs";
import { FileTabs } from "./FileTabs";
import { closeEditorFile, fileTabsOf, openEditorFile } from "./file-tabs";

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
    "main" | "projects" | "projects-add-local" | "projects-create" | "new-workspace"
  >("main");
  const [settingsTabOpen, setSettingsTabOpen] = useState(false);
  const openAppSettings = () => {
    setSettingsTabOpen(true);
    setScreen("main");
    void navigate({ to: "/", search: (before) => ({ ...before, settings: true }) });
  };
  const closeSettings = () => {
    setSettingsTabOpen(false);
    void navigate({ to: "/", search: (before) => ({ ...before, settings: undefined }) });
  };
  const close = () => setScreen("main");

  const setup = useQuery(core("checkSetup"));
  const projects = useQuery(core("listProjects")).data;
  const current = projects?.[0]; // listed most recently opened first
  const selectProject = async (id: number) => {
    await window.coxswain.openProject(id);
    close();
  };

  const preference = useUiPreferences();
  const [leftWidth, setLeftWidth] = preference("leftWidth");
  const [agentsWidth, setAgentsWidth] = preference("agentsWidth");
  // Chat is secondary to the canvas, collapsed by default; an explicit choice survives restarts.
  const agentsOpen = useQuery(core("getAgentPaneOpen")).data ?? false;
  const setAgentsOpen = (open: boolean) => {
    queryClient.setQueryData(core("getAgentPaneOpen").queryKey, open);
    void window.coxswain.setAgentPaneOpen(open);
  };
  // The pane on the left of the canvas, under its own bar: the Navigator on top, the commits or the agent turns below.
  // Starts open, with history collapsed to its bar at the pane’s bottom.
  const [paneOpen, setPaneOpen] = preference("paneOpen");
  const [history, setHistory] = preference("history");
  const [historyOpen, setHistoryOpen] = preference("historyOpen");
  const [groupChanges, setGroupChanges] = preference("groupChanges");
  const [guideDescriptionPosition, setGuideDescriptionPosition] = preference(
    "guideDescriptionPosition",
  );
  const [historyHeight, setHistoryHeight] = preference("historyHeight");
  const [guideOptions, setGuideOptions] = preference("guideOptions");
  useEffect(() => {
    if (agentsOpen) activateFindPane("chat");
  }, [agentsOpen]);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);
  const [sendingReview, setSendingReview] = useState(false);

  const showHistory = (t: HistoryTab) => {
    pickPaneTab("diffs");
    setHistory(t);
    setHistoryOpen(true);
    setPaneOpen(true);
  };
  // ⌘B-like toggle for Commits or Turns: hides the bottom half if it already shows them.
  const toggleHistory = (t: HistoryTab) =>
    paneOpen && historyOpen && history === t ? setHistoryOpen(false) : showHistory(t);

  const [viewSettings, setViewSettings] = preference("viewSettings");
  const workspaces =
    useQuery({ ...core("listWorkspaces", current?.id ?? 0), enabled: !!current }).data ?? [];
  const closedTabQuery = useQuery(core("getClosedWorkspaceTabs"));
  const closedTabs = new Set(closedTabQuery.data ?? []);
  const changeTab = (id: number, open: boolean) => {
    const key = core("getClosedWorkspaceTabs").queryKey;
    const before = queryClient.getQueryData<number[]>(key) ?? [];
    queryClient.setQueryData(
      key,
      open ? before.filter((tab) => tab !== id) : [...new Set([...before, id])],
    );
    void window.coxswain
      .setWorkspaceTabOpen(id, open)
      .catch(() => queryClient.setQueryData(key, before));
  };
  const openWorkspaces = closedTabQuery.data ? workspaces.filter((w) => !closedTabs.has(w.id)) : [];
  const latestWorkspace = openWorkspaces.reduce<Workspace | undefined>(
    (latest, w) => (!latest || w.lastOpenedAt > latest.lastOpenedAt ? w : latest),
    undefined,
  );
  const currentWorkspace = openWorkspaces.find((w) => w.id === search.ws) ?? latestWorkspace;
  const tabRequest = useRef(0);
  const selectWorkspace = async (id: number) => {
    const request = ++tabRequest.current;
    const destination = {
      ...(workspaceLocations.current.get(id) ?? { ws: id }),
      settings: undefined,
    };
    await prepareGuide(id, destination).catch(() => {});
    if (request !== tabRequest.current) return;
    if (closedTabs.has(id)) changeTab(id, true);
    close();
    return navigate({ to: "/", search: destination });
  };
  const closeWorkspaceTab = (w: Workspace) => {
    tabRequest.current++;
    changeTab(w.id, false);
    if (w.id !== currentWorkspace?.id) return;
    const index = openWorkspaces.findIndex((tab) => tab.id === w.id);
    const remaining = openWorkspaces.filter((tab) => tab.id !== w.id);
    const next = remaining[Math.min(index, remaining.length - 1)];
    if (next) void selectWorkspace(next.id);
    else void navigate({ to: "/", search: {} });
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
      message: `Remove ${workspaceLabel(w)} from the workspace tabs?`,
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
  useEffect(() => {
    const id = search.ws;
    if (!moved || !id || !closedTabs.has(id)) return;
    changeTab(id, true);
  }, [moved, search.ws]);
  // A new entry with these changes to what the canvas shows. Stable, so the memoised Viewers don't redraw.
  const show = useCallback(
    (changes: CanvasSearch, replace = false) => {
      tabRequest.current++;
      return navigate({
        to: "/",
        search: {
          ...shown.current,
          settings: undefined,
          codeLine: undefined,
          thread: undefined,
          pr: undefined,
          section: undefined,
          ...changes,
        },
        replace,
      });
    },
    [navigate],
  );
  const canBack = location.state.__TSR_index > 0;
  const canForward = location.state.__TSR_index < router.history.length - 1;
  useEffect(() => window.coxswain.setNavigation(canBack, canForward), [canBack, canForward]);
  // Initial project load (or removal of the selected workspace) uses its last opened workspace.
  useEffect(() => {
    if (moved && search.ws && closedTabs.has(search.ws)) return;
    if (currentWorkspace && search.ws !== currentWorkspace.id)
      void navigate({
        to: "/",
        search: workspaceLocations.current.get(currentWorkspace.id) ?? { ws: currentWorkspace.id },
        replace: true,
      });
  }, [currentWorkspace?.id, search.ws, moved]);
  useEffect(() => {
    if (search.ws === currentWorkspace?.id && search.ws !== undefined)
      workspaceLocations.current.set(search.ws, search);
  }, [search, currentWorkspace?.id]);
  useEffect(() => {
    if (!currentWorkspace) return;
    void window.coxswain.openWorkspace(currentWorkspace.id);
  }, [currentWorkspace?.id]);

  const view: PaneTab = s.view ?? "sections";
  const viewsQuery = useQuery({
    ...core("listViews", currentWorkspace?.id ?? 0),
    enabled: !!currentWorkspace,
  });
  const views = viewsQuery.data ?? (viewsQuery.isError ? noViews : undefined);
  const pinnedGuide =
    view === "sections" && s.viewId !== null && !s.commit && !s.scope ? views?.[0] : undefined;
  const pr = usePullRequest(currentWorkspace, pinnedGuide);

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
  // On opening a workspace the newest shows in place (unless one was chosen); a new view shows as an entry of its own.
  const viewId = defaultViewId(s, views, pr.snapshot, pr.snapshotReady);
  const newest = useRef<{ workspaceId: number; id: number; head?: string } | null>(null);
  useEffect(() => {
    if (!currentWorkspace || !views || !pr.commits || !pr.snapshotReady) return;
    const latest = views[0];
    const now = shown.current;
    if (newest.current?.workspaceId !== currentWorkspace.id) {
      if (now.viewId === undefined)
        void show({ viewId: defaultViewId(now, views, pr.snapshot, pr.snapshotReady) }, true);
    } else if (
      latest &&
      (latest.id !== newest.current.id || latest.head !== newest.current.head) &&
      (now.view ?? "sections") === "sections"
    ) {
      const saved = guideScrolls.current.get(currentWorkspace.id);
      if (saved) pendingGuideScroll.current = { workspaceId: currentWorkspace.id, position: saved };
      void show({ viewId: latest.id, commit: undefined, at: undefined });
    }
    newest.current = { workspaceId: currentWorkspace.id, id: latest?.id ?? 0, head: latest?.head };
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
        currentWorkspace?.prNumber != null
          ? "the PR's changes on GitHub"
          : current?.github
            ? "the changes on GitHub"
            : "the changes pushed",
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

  // The workspace's entries, as the canvas shows them (ADR 0015: current or outdated in the live diff, shown or not in
  // the range picked). An explanation or finding shows only with its view.
  const mergeBase = pr.commits?.mergeBase;
  const base = range?.base ?? mergeBase;
  const entriesQuery = useQuery({
    ...core("listEntries", currentWorkspace?.id ?? 0, mergeBase ?? "", base ?? "", range?.head),
    enabled: !!currentWorkspace && !!base && !!mergeBase,
  });
  const allEntries = entriesQuery.data;
  const entries = useMemo(() => {
    if (!allEntries) return noEntries;
    const roots = new Set(
      allEntries
        .filter(
          (entry) =>
            !entry.parentId &&
            (!entry.viewId || entry.viewId === canvasView?.id || (!canvasView && !!entry.path)),
        )
        .map((entry) => entry.id),
    );
    return allEntries.filter((entry) => roots.has(entry.parentId ?? entry.id));
  }, [allEntries, canvasView?.id]);
  // Callbacks handed to the Viewers are stable (useCallback), so a memoised Viewer doesn't redraw its file diff.
  // Paths of the reviewed file diffs: the live diff's, reloaded with the changes, since a file diff that changed is no
  // longer reviewed (ADR 0014); or at a view's head, where they stay as they were.
  const reviewedBase = range?.base ?? mergeBase;
  const reviewedQuery = useQuery({
    ...core("listReviewed", currentWorkspace?.id ?? 0, reviewedBase ?? "", range?.head),
    enabled: !!currentWorkspace && !!reviewedBase && (!!pr.changed || !!canvasView),
  });
  const reviewed = reviewedQuery.data ?? noPaths;
  const changedSinceReview =
    useQuery({
      ...core("listChangedSinceReview", currentWorkspace?.id ?? 0, reviewedBase ?? "", range?.head),
      enabled: !!currentWorkspace && !!reviewedBase && (!!pr.changed || !!canvasView),
    }).data ?? noPaths;

  // Keep the live Changes count warm while Guide reads its pinned review range.
  const liveReviewedQuery = useQuery({
    ...core("listReviewed", currentWorkspace?.id ?? 0, mergeBase ?? "", undefined),
    enabled: !!currentWorkspace && !!mergeBase && !!pr.changed,
  });
  const reviewedFilesQuery = useQuery({
    ...core("listReviewed", currentWorkspace?.id ?? 0, reviewedBase ?? "", range?.head, "file"),
    enabled: !!currentWorkspace && !!canvasView && !!reviewedBase,
  });
  const reviewedFiles = reviewedFilesQuery.data ?? noPaths;
  const isReviewed = (opened: Opened) =>
    (opened.kind === "file" ? reviewedFiles : reviewed).includes(openedPath(opened));
  // Review navigation follows the rendered file order in Changes and Guide.
  const [reviewReveal, setReviewReveal] = useState<string | null>(null);
  const [fileDisclosure, setFileDisclosure] = useState<Record<string, boolean>>({});
  const disclosureKey = (path: string, kind?: "file") =>
    `${currentWorkspace?.id}:${viewId ?? reviewedBase}:${range?.head ?? "live"}:${kind ?? "diff"}:${path}`;
  const setFileCollapsed = (path: string, collapsed: boolean, kind?: "file") =>
    setFileDisclosure((before) => ({ ...before, [disclosureKey(path, kind)]: collapsed }));
  const markReviewed = useCallback(
    (path: string, on: boolean, kind?: "file") => {
      if (!currentWorkspace || !reviewedBase) return;
      const scroller = canvas.current && canvasScroller(canvas.current);
      const diffs = [...(scroller?.querySelectorAll<HTMLElement>('[id^="diff:"]') ?? [])];
      const i = diffs.findIndex((el) => el.id === `diff:${path}`);
      const next = diffs.slice(i + 1).find((el) => el.dataset.reviewed !== "true");
      setFileCollapsed(path, on, kind);
      mark(currentWorkspace.id, reviewedBase, path, on, range?.head, kind);
      if (!on || i < 0 || !next || !scroller) return;
      const anchor = next;
      reviewScroll.current?.();
      const frame = requestAnimationFrame(() => {
        if (!canvas.current) return;
        reviewScroll.current = restoreScroll(canvas.current, {
          top: 0,
          anchor: anchor.id,
          offset: -(parseFloat(getComputedStyle(scroller).scrollPaddingTop) || 0),
        });
      });
      reviewScroll.current = () => cancelAnimationFrame(frame);
    },
    [currentWorkspace?.id, viewId, reviewedBase, range?.head],
  );
  // Marks all of a view section's files and file diffs, or unmarks them.
  const markSection = (files: Opened[], on: boolean) => {
    if (!currentWorkspace || !reviewedBase) return;
    for (const d of files) {
      setFileCollapsed(openedPath(d), on, d.kind === "file" ? "file" : undefined);
      if (isReviewed(d) === on) continue;
      mark(
        currentWorkspace.id,
        reviewedBase,
        openedPath(d),
        on,
        range?.head,
        d.kind === "file" ? "file" : undefined,
      );
    }
  };
  // Questions' turns by thread, kept here so they outlive the Viewer showing them. The reply streams in as chat
  // entries; once the turn ends it's an answer entry. The streamed reply stays until the next turn, so the thread
  // keeps it until the answer entry is read (#38). A tool use to approve waits in permission until answered.
  const [turns, setTurns] = useState<Record<number, Turn>>({});
  useEffect(() => {
    const offChat = window.coxswain.onQuestionChat((id, c) =>
      setTurns((t) => ({
        ...t,
        [id]: {
          running: true,
          queued: false,
          error: null,
          live: upsert(t[id]?.running ? t[id].live : [], c),
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
          live: t[id]?.live ?? [],
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
        live: t[id]?.running ? t[id].live : [],
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
  const paneScrolls = useRef(new Map<string, Scroll>());
  const lastPane = useRef<string | undefined>(undefined);
  const restoredCanvas = useRef<HTMLElement | null>(null);
  const guideScrolls = useRef(new Map<number, Scroll>());
  const pendingGuideScroll = useRef<{ workspaceId: number; position: Scroll } | null>(null);
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
  const diffDiffs = useMemo(() => {
    const files = range ? rangeChanged : pr.changed;
    if (!files) return range ? undefined : diffs;
    const ordered = canvasView ? files : orderChanges(files, viewSettings.layout, groupChanges);
    return ordered.map((file) => ({ kind: "diff" as const, file }));
  }, [!!range, rangeChanged, diffs, pr.changed, !!canvasView, viewSettings.layout, groupChanges]);
  // Explicit sidebar navigation temporarily reveals only the reviewed card requested.
  const isShown = (d: Opened) =>
    viewSettings.showReviewed ||
    (reviewReveal === disclosureKey(openedPath(d), d.kind === "file" ? "file" : undefined) &&
      fileDisclosure[reviewReveal] !== true) ||
    !isReviewed(d);
  const isCollapsed = (d: Opened) =>
    fileDisclosure[disclosureKey(openedPath(d), d.kind === "file" ? "file" : undefined)] ??
    (s.at !== openedPath(d) && isReviewed(d));
  const shownDiffs = useMemo(
    () => diffDiffs?.filter(isShown),
    [diffDiffs, reviewed, viewSettings.showReviewed, reviewReveal, fileDisclosure],
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
  }, [canvasView, diffDiffs]);
  const canvasFiles = sections?.flatMap((s) => s.files) ?? diffDiffs ?? [];
  // Reading position is transient, separate from the router's click destination.
  const [readingPosition] = useState(createGuideReadingPosition);
  const guideReading = useRef(new Map<string, { section: number; file?: string }>());
  const guideTracking = useRef<{ settling: boolean; timer?: ReturnType<typeof setTimeout> }>({
    settling: true,
  });
  useLayoutEffect(() => {
    // The virtualizer and scroll restoration can briefly report the old view's geometry.
    // Restore the last reading marker before paint, then ignore intermediate layout corrections.
    guideTracking.current.settling = true;
    clearTimeout(guideTracking.current.timer);
    const cached = guideReading.current.get(`${currentWorkspace?.id}:${canvasView?.id}`);
    readingPosition.set(cached && canvasView ? { viewId: canvasView.id, ...cached } : undefined);
    return () => clearTimeout(guideTracking.current.timer);
  }, [currentWorkspace?.id, canvasView?.id]);
  const readGuide = (scroller: HTMLElement) => {
    // Unmount/resize callbacks can arrive after PR overview has replaced the review canvas.
    if (
      s.pr ||
      search.settings ||
      !scroller.isConnected ||
      !canvas.current?.isConnected ||
      !canvas.current.contains(scroller)
    )
      return;
    const nodes = canvas.current?.querySelectorAll<HTMLElement>(".guide-section[id]");
    if (!nodes?.length) {
      readingPosition.set(undefined);
      return;
    }
    const styles = getComputedStyle(nodes[0]);
    const viewport = scroller.getBoundingClientRect();
    const top = viewport.top + (parseFloat(styles.scrollMarginTop) || 0) + 1;
    let current = 0;
    nodes.forEach((node, index) => {
      if (node.getBoundingClientRect().top <= top) current = index;
    });
    const cards = [...nodes[current].querySelectorAll<HTMLElement>('[id^="diff:"]')];
    let file: HTMLElement | undefined;
    for (const card of cards) {
      const bounds = card.getBoundingClientRect();
      if (!file && bounds.top < viewport.bottom) file = card;
      if (bounds.top <= top) file = card;
    }
    readingPosition.set(
      canvasView
        ? {
            viewId: canvasView.id,
            section: current,
            file: file?.id.slice("diff:".length),
          }
        : undefined,
    );
    if (currentWorkspace && canvasView) {
      guideReading.current.set(`${currentWorkspace.id}:${canvasView.id}`, {
        section: current,
        file: file?.id.slice("diff:".length),
      });
    }
  };
  const followGuide = (scroller: HTMLElement) => {
    if (s.pr || view !== "sections" || !canvasView || !scroller.isConnected) return;
    if (!guideTracking.current.settling) return readGuide(scroller);
    clearTimeout(guideTracking.current.timer);
    guideTracking.current.timer = setTimeout(() => {
      guideTracking.current.settling = false;
      readGuide(scroller);
    }, 120);
  };
  const paneKey = `${currentWorkspace?.id}:${s.pr ? "pr" : view}:${s.file ?? ""}:${s.fileAt ?? ""}`;
  const scrollFrame = useRef<number | undefined>(undefined);
  useLayoutEffect(
    () => () => {
      if (scrollFrame.current !== undefined) cancelAnimationFrame(scrollFrame.current);
      scrollFrame.current = undefined;
      clearTimeout(guideTracking.current.timer);
    },
    [paneKey, screen],
  );
  const rememberScroll = (position: Scroll) => {
    paneScrolls.current.set(paneKey, position);
    scrolls.current.set(entry(), position);
    if (
      !s.pr &&
      currentWorkspace &&
      view === "sections" &&
      canvasView &&
      !guideTracking.current.settling
    )
      guideScrolls.current.set(currentWorkspace.id, position);
  };
  // Save the cheap offset immediately, but measure anchors/read markers at most once per display frame.
  const onCanvasScroll = (e: UIEvent<HTMLDivElement>) => {
    if (s.pr) return;
    const scroller = e.target as HTMLElement;
    if (scroller.parentElement !== e.currentTarget) return;
    rememberScroll({ top: scroller.scrollTop, offset: 0 });
    if (scrollFrame.current !== undefined) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = undefined;
      if (!scroller.isConnected) return;
      followGuide(scroller);
      rememberScroll(scrollOf(scroller));
    });
  };
  const [updatingGuide, setUpdatingGuide] = useState<number | null>(null);
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
  // The pane's bar: Changes and Files are the Navigator's toggle (a history entry, ADR 0025).
  const pickPaneTab = (t: PaneTab) => {
    if (t === view) return;
    match(t)
      .with("sections", () => {
        const saved = currentWorkspace && guideScrolls.current.get(currentWorkspace.id);
        if (saved && currentWorkspace)
          pendingGuideScroll.current = { workspaceId: currentWorkspace.id, position: saved };
        void show({
          view: "sections",
          file: undefined,
          at: undefined,
          ...(canvasView ? {} : { viewId: views?.[0]?.id, commit: undefined, scope: undefined }),
        });
      })
      .with("files", () => {
        const tab = s.editorFile ?? fileTabsOf(s).at(-1);
        void show(tab ? openEditorFile(s, tab) : { view: "files" });
      })
      .with(
        "diffs",
        () => void show({ view: "diffs", viewId: null, file: undefined, fileAt: undefined }),
      )
      .exhaustive();
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
  // ADR 0040: a project not on GitHub pushes to its origin, whatever that is.
  const pushedTo = current?.github ? "GitHub" : "origin";
  const push = async (w: Workspace) => {
    const ok = await window.coxswain.confirm({
      message: `Push ${w.branch ? `“${w.branch}”` : "the PR's branch"} to ${pushedTo}?`,
      detail: `Its commits that aren't pushed yet go to ${pushedTo}. Uncommitted changes stay here.`,
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
  // Explicit Files navigation: on the canvas, at `line` if given, with the Navigator on Files and the file
  // revealed there. Files, Open Quickly, Go to Definition and Find Usages all go through it. Stable, so the memoised
  // Viewers don't all redraw.
  const openFile = useCallback(
    (path: string, line?: number, commit?: string) => {
      setPaneOpen(true);
      // The same file again without a line (e.g. the tree selecting the one it revealed) is no new entry.
      const now = shown.current;
      if (!line && now.view === "files" && now.file === path && now.fileAt === commit) return;
      void show(openEditorFile(now, { path, commit }, line));
    },
    [show],
  );
  const reviewSurface = useRef<ReviewSurface>({ visible: [], base: "" });
  reviewSurface.current = {
    visible: canvasFiles.filter(isShown),
    base: range?.base ?? pr.commits?.mergeBase ?? "",
    head: range?.head,
  };
  const expandSourceFile = useRef(setFileCollapsed);
  expandSourceFile.current = setFileCollapsed;
  const openSourceFile = useCallback(
    (path: string, line?: number, commit?: string) => {
      const destination = reviewSourceDestination(
        shown.current,
        reviewSurface.current,
        path,
        line,
        commit,
      );
      if (!destination) return openFile(path, line, commit);
      const file = reviewSurface.current.visible.find(
        (file) => openedPath(file) === destination.at,
      );
      expandSourceFile.current(destination.at, false, file?.kind === "file" ? "file" : undefined);
      void show(destination);
    },
    [openFile, show],
  );
  // An entry of its own, though the canvas still shows the file diffs.
  const openReviewFile = async (path: string, pane: "sections" | "diffs") => {
    const file = canvasFiles.find((file) => openedPath(file) === path);
    setReviewReveal(
      file && isReviewed(file)
        ? disclosureKey(path, file.kind === "file" ? "file" : undefined)
        : null,
    );
    setFileCollapsed(path, false);
    // The first card shares its section's destination, including on narrow layouts
    // where the explanation sits above the cards. Keep at to reveal reviewed files.
    const section =
      pane === "sections"
        ? sections?.findIndex((item) =>
            item.files[0] ? openedPath(item.files[0]) === path : false,
          )
        : undefined;
    await show({
      view: pane,
      file: undefined,
      fileAt: undefined,
      ...(pane === "diffs" ? { viewId: null } : {}),
      at: path,
      section: section !== undefined && section >= 0 ? section : undefined,
    });
  };
  const showFile = view === "files" && opened;
  const editorTabs = fileTabsOf(s);
  // The command palette, with its first query while it's open: ">" for actions (⌘K), "" for files (Open Quickly, ⌘⇧O).
  // File search reuses a displayed review file before opening Files.
  const [palette, setPalette] = useState<string | null>(null);
  const openQuickly = (path: string) => {
    setPalette(null);
    openSourceFile(path);
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
    if (root.path) setFileCollapsed(root.path, false);
    const revealed = canvasFiles.find((file) => openedPath(file) === root.path);
    setReviewReveal(
      root.path ? disclosureKey(root.path, revealed?.kind === "file" ? "file" : undefined) : null,
    );
    // Already on the canvas (its file shows and its lines are there, e.g. a note written in the view shown): scroll to
    // it in place rather than leave for the range it was written in.
    const here = entries.find((e) => e.id === threadId);
    if (view === "diffs" && root.path && canvasFiles.some((file) => openedPath(file) === root.path))
      await show({
        view: "diffs",
        viewId: null,
        thread: threadId,
        at: root.path,
        file: undefined,
        fileAt: undefined,
      });
    else if (root.section != null && !showFile && canvasView?.id === root.viewId)
      await show({ thread: threadId });
    else if (here?.shown && !showFile && canvasFiles.some((f) => openedPath(f) === root.path))
      await show({ thread: threadId, at: root.path! });
    else await show(threadLocation(root));
    setThreadPicks((n) => n + 1);
  };
  const canvasReady =
    view === "files"
      ? !!pr.commits
      : viewId !== undefined &&
        (viewId === null || !!views) &&
        !!pr.commits &&
        !!diffDiffs &&
        !!shownDiffs &&
        (entriesQuery.data !== undefined || entriesQuery.isError) &&
        (reviewedQuery.data !== undefined || reviewedQuery.isError) &&
        (!canvasView || reviewedFilesQuery.data !== undefined || reviewedFilesQuery.isError);
  useEffect(() => {
    if (search.settings || s.pr || !canvasReady || !canvas.current?.isConnected) return;
    const scroller = canvasScroller(canvas.current);
    if (!scroller) return;
    const observer = new ResizeObserver(() => followGuide(scroller));
    observer.observe(scroller);
    followGuide(scroller);
    return () => {
      observer.disconnect();
      clearTimeout(guideTracking.current.timer);
    };
  }, [
    canvasReady,
    currentWorkspace?.id,
    canvasView?.id,
    sections?.length,
    screen,
    search.settings,
    paneKey,
  ]);
  // Restore only the destination's scroll. Retries from an old navigation must never move a new canvas.
  useLayoutEffect(() => {
    if (
      search.settings ||
      s.pr ||
      !canvasReady ||
      !canvas.current?.isConnected ||
      !currentWorkspace
    )
      return;
    const switched = scrollWorkspace.current !== currentWorkspace.id;
    const remounted = restoredCanvas.current !== canvas.current;
    restoredCanvas.current = canvas.current;
    const paneChanged = lastPane.current !== paneKey;
    lastPane.current = paneKey;
    scrollWorkspace.current = currentWorkspace.id;
    const guideReturn = pendingGuideScroll.current;
    if (view === "sections" && canvasView && guideReturn?.workspaceId === currentWorkspace.id) {
      pendingGuideScroll.current = null;
      return restoreScroll(canvas.current, guideReturn.position);
    }
    const saved = moved
      ? scrolls.current.get(location.state.__TSR_key ?? "")
      : paneChanged || remounted
        ? paneScrolls.current.get(paneKey)
        : undefined;
    if (!remounted && (s.thread || (s.section !== undefined && !moved))) return; // explicit navigation owns its scroll
    if (saved) return restoreScroll(canvas.current, saved);
    if (switched || paneChanged) {
      const scroller = canvasScroller(canvas.current);
      if (scroller) scroller.scrollTop = 0;
    }
  }, [
    location.state.__TSR_key,
    currentWorkspace?.id,
    canvasReady,
    canvasView?.id,
    paneKey,
    screen,
  ]);
  useEffect(() => {
    if (s.thread || s.section === undefined || !canvasReady || !canvas.current || !sections) return;
    if (moved && scrolls.current.has(location.state.__TSR_key ?? "")) return;
    const target = canvasElement(canvas.current, `view-section-${s.section}`);
    if (!target) return;
    return restoreScroll(canvas.current, {
      top: 0,
      anchor: target.id,
      offset: -(parseFloat(getComputedStyle(target).scrollMarginTop) || 0),
    });
  }, [location.state.__TSR_key, s.thread, s.section, canvasReady, sections?.length]);
  useEffect(() => {
    if (
      !s.at ||
      s.codeLine ||
      s.thread ||
      s.section !== undefined ||
      !canvasReady ||
      !canvas.current ||
      showFile
    )
      return;
    if (moved && scrolls.current.has(location.state.__TSR_key ?? "")) return;
    const target = canvasElement(canvas.current, `diff:${s.at}`);
    if (!target) return;
    return restoreScroll(canvas.current, {
      top: 0,
      anchor: target.id,
      offset: -(parseFloat(getComputedStyle(target).scrollMarginTop) || 0),
    });
  }, [location.state.__TSR_key, s.at, s.codeLine, canvasReady, !!showFile]);
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
  useEffect(() => {
    if (import.meta.env.DEV)
      performance.mark(
        `cx:canvas:${currentWorkspace?.id}:${view}:${canvasReady ? "ready" : "loading"}`,
      );
  }, [currentWorkspace?.id, view, canvasReady]);

  // The action registry (ADR 0027): everything the command palette lists and the native menu runs, by id. Rebuilt each
  // render, so each action's enabled and run see the current state.
  const onMain = screen === "main" && !search.settings && !!current && palette === null;
  const ready = !!currentWorkspace && !!pr.commits;
  useEffect(() => {
    closeFind(false);
  }, [currentWorkspace?.id, viewId, showFile, range?.base, range?.head, screen]);
  const sidebarThreads = entries.filter((e) => (e.path || e.section != null) && !e.parentId);
  const botAuthors = useMemo(
    () =>
      new Set([
        ...(allEntries ?? []).flatMap((entry) =>
          entry.authorIsBot && entry.author ? [entry.author] : [],
        ),
        ...(pr.details?.threads ?? []).flatMap((thread) =>
          thread.comments.filter((comment) => comment.authorIsBot).map((comment) => comment.author),
        ),
      ]),
    [pr.details, allEntries],
  );
  const guideAuthors = [...new Set(sidebarThreads.map(threadAuthor))]
    .sort()
    .map((name) => ({ name, isBot: botAuthors.has(name) || botLogin(name) }));
  const reviewThreads = sidebarThreads.filter((e) => !e.resolvedAt && isComment(e));
  const canSubmitReview =
    !!currentWorkspace && (!!pr.details || reviewThreads.length > 0) && !sendingReview;
  const submitReview = () => setSubmittingReview(true);
  const showThreads = () => {
    setPaneOpen(true);
    pickPaneTab("sections");
  };
  const sendReview = async (threadIds: number[]) => {
    if (!currentWorkspace) return;
    setSendingReview(true);
    setReviewNotice("Sending review to agent…");
    setAgentsOpen(true);
    try {
      const result = await window.coxswain.sendReview(currentWorkspace.id, threadIds);
      setReviewNotice(result.status === "error" ? result.message : null);
      if (result.status === "error") showThreads();
    } catch (error) {
      setReviewNotice((error as Error).message);
      showThreads();
    } finally {
      setSendingReview(false);
    }
  };
  const actions: Action[] = [
    {
      id: "submit-review",
      title: "Submit Review",
      enabled: onMain && canSubmitReview,
      run: submitReview,
    },
    {
      id: "show-threads",
      title: "Show Threads",
      enabled: onMain && !!currentWorkspace,
      run: showThreads,
    },

    {
      id: "close-workspace-tab",
      title: search.settings ? "Close Settings Tab" : "Close Workspace Tab",
      shortcut: "⌘W",
      enabled: !!search.settings || (onMain && !!currentWorkspace),
      run: () => {
        if (search.settings) closeSettings();
        else if (currentWorkspace) closeWorkspaceTab(currentWorkspace);
      },
    },
    ...Array.from({ length: 9 }, (_, i): Action => {
      const w = i === 8 ? openWorkspaces.at(-1) : openWorkspaces[i];
      return {
        id: `workspace-${i + 1}`,
        title: i === 8 ? "Last Workspace" : `Workspace ${i + 1}`,
        shortcut: `⌘${i + 1}`,
        enabled: screen === "main" && !!w,
        run: () => {
          if (w) void selectWorkspace(w.id);
        },
      };
    }),
    ...([-1, 1] as const).map((by): Action => ({
      id: by === 1 ? "next-workspace" : "previous-workspace",
      title: by === 1 ? "Next Workspace" : "Previous Workspace",
      shortcut: by === 1 ? "⌃Tab" : "⌃⇧Tab",
      enabled: onMain && openWorkspaces.length > 1,
      run: () => {
        const i = openWorkspaces.findIndex((w) => w.id === currentWorkspace?.id);
        const w =
          openWorkspaces[(Math.max(0, i) + by + openWorkspaces.length) % openWorkspaces.length];
        if (w) void selectWorkspace(w.id);
      },
    })),
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
      enabled: onMain && !!currentWorkspace,
      run: openFind,
    },
    {
      id: "find-next",
      title: "Find Next",
      shortcut: "⌘G",
      enabled: onMain && !!currentWorkspace,
      run: () => nextFind(),
    },
    {
      id: "find-previous",
      title: "Find Previous",
      shortcut: "⇧⌘G",
      enabled: onMain && !!currentWorkspace,
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
      id: "toggle-agent-pane",
      title: "Show or Hide the Right Sidebar",
      enabled: !!currentWorkspace,
      run: () => setAgentsOpen(!agentsOpen),
    },
    {
      id: "toggle-commits",
      title: "Show or Hide Commits",
      enabled: ready,
      run: () => toggleHistory("commits"),
    },
    {
      id: "toggle-turns",
      title: "Show or Hide Agent Turns",
      enabled: ready,
      run: () => toggleHistory("turns"),
    },
    {
      id: "show-diff",
      title: "Show Changes",
      enabled: ready && !!canvasView,
      run: () => showView(null),
    },
    { id: "show-guide", title: "Show Guide", enabled: ready, run: () => pickPaneTab("sections") },
    {
      id: "update-guide",
      title: "Update Guide…",
      enabled: ready,
      run: () => setUpdatingGuide(currentWorkspace!.id),
    },
    ...(
      [
        ["all", "Show All Changes"],
        [
          "pushed",
          currentWorkspace?.prNumber !== null
            ? "Show Only the PR's Changes"
            : current?.github
              ? "Show Only What's on GitHub"
              : "Show Only What's Pushed",
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
      enabled: ready && (currentWorkspace.prNumber !== null || (!current?.github && pr.remote)),
      run: () => void push(currentWorkspace!),
    },
    {
      id: "open-pull-request",
      title: "Open Pull Request…",
      enabled: ready && currentWorkspace.prNumber === null && !!current?.github,
      run: () => void openPullRequest(currentWorkspace!),
    },
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
      title: `Switch to Project: ${projectLabel(p)}`,
      enabled: p.id !== current?.id,
      run: () => void selectProject(p.id),
    })),
    { id: "add-project", title: "Add Project…", run: () => setScreen("projects") },
    // ADR 0040: straight to the native dialog; what git refuses shows in Open a project.
    {
      id: "add-local-repository",
      title: "Add Local Repository…",
      run: () => setScreen("projects-add-local"),
    },
    { id: "new-project", title: "New Project…", run: () => setScreen("projects-create") },
    { id: "settings", title: "Settings…", shortcut: "⌘,", run: () => openAppSettings() },
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
    onOpenFile: openSourceFile,
    codeLine: s.codeLine,
    codeLinePassive: moved,
    codeLineVersion: location.state.__TSR_key,
    diffStyle: viewSettings.diffStyle,
    revealThread: s.thread,
    revealVersion: threadPicks,
    onThreadResolved: (id: number) => {
      if (shown.current.thread === id) void show({ thread: undefined });
    },
    onCollapsedChange: setFileCollapsed,
  });

  if (!setup.data) return null; // local and quick, like the projects below
  if (setup.data.problems.length)
    return <Setup check={setup.data} onRetry={() => void setup.refetch()} />;
  if (search.settings && !current) return <Settings onClose={closeSettings} />;
  // Projects and New workspace are dialogs over the screen below them.
  const dialog =
    screen === "projects" || screen === "projects-add-local" || screen === "projects-create" ? (
      <Projects
        projects={projects ?? []}
        current={current}
        start={match(screen)
          .with("projects-add-local", () => "add-local" as const)
          .with("projects-create", () => "create" as const)
          .otherwise(() => null)}
        onSelect={selectProject}
        onAdded={close}
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
          onSettings={() => openAppSettings()}
          onChooseProject={() => setScreen("projects")}
        />
        {dialog}
        {updatingGuide !== null && (
          <UpdateGuideDialog workspaceId={updatingGuide} onClose={() => setUpdatingGuide(null)} />
        )}
      </>
    );

  const openSettings = async () => {
    const result = await window.coxswain.showSettingsMenu(
      viewSettings,
      guideDescriptionPosition,
      !!currentWorkspace,
      currentWorkspace?.id ?? null,
    );
    match(result)
      .with({ kind: "app" }, () => openAppSettings())
      .with({ kind: "display" }, ({ settings }) => {
        if (!settings.showReviewed) setReviewReveal(null);
        setViewSettings(settings);
      })
      .with({ kind: "description-position" }, ({ position }) =>
        setGuideDescriptionPosition(position),
      )
      .with({ kind: "auto-update" }, () => {})
      .with({ kind: "update-guide" }, () => {
        if (currentWorkspace) setUpdatingGuide(currentWorkspace.id);
      })
      .with({ kind: "dismissed" }, () => {})
      .exhaustive();
  };
  // Workspace tabs above the primary canvas, with optional navigation and chat panes.
  return (
    // Side panes keep their dragged width but shrink with the window before the Viewer goes below viewerMin.
    <div className="workspace-shell relative flex h-full flex-col select-none overflow-hidden text-sm">
      {dialog}
      {updatingGuide !== null && (
        <UpdateGuideDialog workspaceId={updatingGuide} onClose={() => setUpdatingGuide(null)} />
      )}
      {submittingReview && currentWorkspace && (
        <SubmitReviewDialog
          key={currentWorkspace.id}
          workspaceId={currentWorkspace.id}
          pr={pr.details}
          onViewThread={viewThread}
          onSendToAgent={(ids) => void sendReview(ids)}
          onCopied={() => {
            setReviewNotice("Review prompt copied");
            showThreads();
          }}
          onClose={() => setSubmittingReview(false)}
        />
      )}
      <WorkspaceTabs
        project={current}
        cloning={cloning}
        workspaces={openWorkspaces}
        current={currentWorkspace}
        onProjects={async () => {
          const picked = await window.coxswain.showProjectsMenu(
            projects.map((p) => ({ id: p.id, label: projectLabel(p) })),
          );
          if (picked === null) setScreen("projects");
          else if (picked !== current.id) await selectProject(picked);
        }}
        onSelect={(w) => void selectWorkspace(w.id)}
        onRemove={removeWorkspace}
        onClose={closeWorkspaceTab}
        settingsOpen={settingsTabOpen || !!search.settings}
        settingsActive={!!search.settings}
        onSelectSettings={openAppSettings}
        onCloseSettings={closeSettings}
        onNew={() => setScreen("new-workspace")}
        agentsOpen={agentsOpen}
        onToggleAgents={() => setAgentsOpen(!agentsOpen)}
        onSettings={() => void openSettings()}
        paneOpen={paneOpen}
        onTogglePane={() => setPaneOpen((open) => !open)}
        pullRequest={pr.details}
        onShowPr={() => void show({ pr: true })}
        prOpen={!!s.pr}
      />

      {palette !== null && (
        <CommandPalette
          workspaceId={currentWorkspace?.id}
          actions={actions}
          initialQuery={palette}
          onOpen={openQuickly}
          onClose={() => setPalette(null)}
        />
      )}
      {(settingsTabOpen || search.settings) && (
        <div
          className="flex min-h-0 flex-1 pt-[var(--ui-toolbar-height)]"
          style={!search.settings ? { display: "none" } : undefined}
        >
          <Settings embedded onClose={closeSettings} workspaceId={currentWorkspace?.id} />
        </div>
      )}
      <div
        className="flex min-h-0 flex-1"
        style={search.settings ? { display: "none" } : undefined}
      >
        {/* The canvas: what the agent and the human look at together. For now, the workspace's file diffs. */}
        <div
          style={{ minWidth: viewerMin }}
          className="relative flex min-w-0 flex-1 flex-col"
          onPointerDownCapture={() => activateFindPane("canvas")}
          onFocusCapture={() => activateFindPane("canvas")}
        >
          {!currentWorkspace ? (
            <Centered>No open tabs. Reopen a workspace with ⌘K, or start one with +</Centered>
          ) : (
            <div className="flex min-h-0 flex-1">
              {
                <>
                  <div
                    style={{ width: leftWidth, display: paneOpen ? undefined : "none" }}
                    className={cn(
                      "workspace-sidebar flex min-w-60 flex-col border-r pt-[var(--ui-toolbar-height)]",
                      divider,
                    )}
                  >
                    <PaneBar
                      tab={view}
                      files={fileCountLabel(
                        view === "diffs" ? diffPr.changed : pr.changed,
                        view === "diffs" ? reviewedQuery.data : liveReviewedQuery.data,
                        viewSettings.showReviewed,
                      )}
                      onTab={pickPaneTab}
                      onHide={() => setPaneOpen(false)}
                      onOptions={() =>
                        match(view)
                          .with("sections", async () => {
                            const picked = await window.coxswain.showGuideMenu(
                              guideOptions,
                              guideAuthors,
                            );
                            if (picked !== null) setGuideOptions(picked);
                          })
                          .with("diffs", async () => {
                            const picked = await window.coxswain.showChangesMenu(
                              guideOptions,
                              guideAuthors,
                              viewSettings.layout,
                              groupChanges,
                            );
                            match(picked)
                              .with({ kind: "grouping" }, ({ enabled }) => setGroupChanges(enabled))
                              .with({ kind: "filters" }, ({ options }) => {
                                setGuideOptions(options);
                              })
                              .with({ kind: "layout" }, ({ layout }) =>
                                setViewSettings((settings) => ({ ...settings, layout })),
                              )
                              .with(null, () => {})
                              .exhaustive();
                          })
                          .with("files", async () => {
                            const settings = await window.coxswain.showFilesMenu(viewSettings);
                            if (settings) setViewSettings(settings);
                          })
                          .exhaustive()
                      }
                    />
                    <div className="flex min-h-0 flex-1 flex-col">
                      <div
                        className={cn(
                          "flex flex-1 flex-col",
                          view === "diffs" && historyOpen && pr.commits ? "min-h-24" : "min-h-0",
                        )}
                      >
                        {view === "sections" ? (
                          <>
                            <GuideProgress
                              workspaceId={currentWorkspace.id}
                              hasGuide={!!views?.some((item) => item.guide)}
                            />
                            <Sections
                              follow={!s.pr}
                              sections={sections}
                              readingPosition={readingPosition}
                              viewId={canvasView?.id}
                              entries={entries}
                              turns={turns}
                              options={guideOptions}
                              showReviewed={viewSettings.showReviewed}
                              authors={guideAuthors}
                              changed={diffPr.changed ?? []}
                              changedSinceReview={changedSinceReview}
                              isReviewed={isReviewed}
                              onOpenFile={(path) => openReviewFile(path, "sections")}
                              onFileReviewedChange={(file, on) =>
                                markReviewed(
                                  openedPath(file),
                                  on,
                                  file.kind === "file" ? "file" : undefined,
                                )
                              }
                              onViewThread={viewThread}
                              notice={reviewNotice}
                              onPick={(section) => void show({ section, file: undefined })}
                              onReviewedChange={(index, on) =>
                                markSection(sections?.[index]?.files ?? [], on)
                              }
                            />
                          </>
                        ) : null}
                        <RetainedNavigator
                          key={currentWorkspace.id}
                          workspace={currentWorkspace}
                          pr={diffPr}
                          livePr={pr}
                          options={guideOptions}
                          authors={guideAuthors}
                          turns={turns}
                          onViewThread={viewThread}
                          view={view}
                          layout={viewSettings.layout}
                          groupChanges={groupChanges}
                          reviewed={reviewed}
                          changedSinceReview={changedSinceReview}
                          showReviewed={viewSettings.showReviewed}
                          entries={entries}
                          local={range ? undefined : (pr.local ?? undefined)}
                          selected={
                            view === "diffs"
                              ? s.at
                              : opened?.kind === "file"
                                ? opened.path
                                : undefined
                          }
                          onOpen={(path) => openReviewFile(path, "diffs")}
                          onOpenFile={openFile}
                          onReviewedChange={markReviewed}
                        />
                      </div>
                      {view === "diffs" && historyOpen && pr.commits && (
                        <Splitter
                          axis="y"
                          fromEnd
                          min={96}
                          max={1200}
                          remainingMin={96}
                          label="Resize Commits and Turns"
                          onResize={setHistoryHeight}
                        />
                      )}
                      {view === "diffs" && (
                        <div
                          style={
                            historyOpen && pr.commits
                              ? { height: historyHeight ?? "50%", maxHeight: "calc(100% - 96px)" }
                              : undefined
                          }
                          className="flex shrink-0 flex-col min-h-0"
                        >
                          <HistoryBar
                            tab={history}
                            open={historyOpen && !!pr.commits}
                            ready={!!pr.commits}
                            onTab={showHistory}
                            onToggle={() => setHistoryOpen((o) => !o)}
                          />
                          {historyOpen &&
                            pr.commits &&
                            (history === "turns" ? (
                              <Turns
                                workspaceId={currentWorkspace.id}
                                current={commit}
                                onPick={pickCommit}
                              />
                            ) : (
                              <Commits
                                workspaceId={currentWorkspace.id}
                                mergeBase={pr.commits.mergeBase}
                                head={pr.commits.head}
                                canOpenPr={currentWorkspace.prNumber === null && !!current.github}
                                remote={pr.remote}
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
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {paneOpen && (
                    <Splitter
                      min={240}
                      max={720}
                      onResize={setLeftWidth}
                      label="Resize file sidebar"
                    />
                  )}
                </>
              }
              <div className="relative flex min-w-0 flex-1 flex-col">
                <div
                  className={cn(
                    "absolute right-4 left-4 z-40",
                    view === "files"
                      ? "top-[calc(var(--ui-toolbar-height)+48px)]"
                      : "top-[calc(var(--ui-toolbar-height)+8px)]",
                  )}
                >
                  <FindBar pane="canvas" />
                </div>
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
                  <PreserveReviewScroll
                    canvasRef={canvas}
                    identity={`${currentWorkspace.id}:${view}:${viewId ?? "changes"}`}
                    showReviewed={viewSettings.showReviewed}
                  >
                    <RetainedCanvas
                      key={currentWorkspace.id}
                      surface={match(view)
                        .with("files", () => "files" as const)
                        .with("sections", () =>
                          canvasView ? ("guide" as const) : ("changes" as const),
                        )
                        .with("diffs", () => "changes" as const)
                        .exhaustive()}
                      ready={canvasReady}
                      canvasRef={canvas}
                    >
                      <div
                        style={{ minWidth: viewerMin }}
                        className="review-canvas flex min-w-0 flex-1 flex-col bg-neutral-50 dark:bg-neutral-950"
                        onScrollCapture={onCanvasScroll}
                      >
                        {view === "files" && (
                          <div className="shrink-0 pt-[var(--ui-toolbar-height)]">
                            <FileTabs
                              tabs={editorTabs}
                              active={s.file ? { path: s.file, commit: s.fileAt } : undefined}
                              onSelect={(tab) => openFile(tab.path, undefined, tab.commit)}
                              onClose={(tab) => void show(closeEditorFile(s, tab))}
                            />
                          </div>
                        )}
                        {!canvasReady ? (
                          <Centered>
                            {pr.commits || pr.problem ? "Loading…" : "Preparing the workspace…"}
                          </Centered>
                        ) : (
                          <>
                            {showFile && (
                              // One Viewer per file: a reused one would scroll to a line in the file it drew before.
                              <Viewer
                                editor
                                key={`${currentWorkspace.id}:${openedPath(opened)}:${s.fileAt ?? "live"}`}
                                opened={opened}
                                reviewed={false}
                                {...viewerProps(currentWorkspace, pr.commits!.mergeBase, s.fileAt)}
                              />
                            )}
                            {view === "files" && !showFile && (
                              <Centered>Open a file from the sidebar or with ⇧⌘O</Centered>
                            )}
                            {view !== "files" && canvasView?.writing && !showFile && (
                              <WritingViewNotice />
                            )}
                            {canvasView?.worktree &&
                              view !== "files" &&
                              pr.snapshot &&
                              canvasView.head !== pr.snapshot &&
                              !showFile && (
                                <StaleViewNotice
                                  onUpdate={() => setUpdatingGuide(currentWorkspace.id)}
                                />
                              )}
                            {!canvasView && view !== "files" && shownDiffs?.length === 0 && (
                              <div
                                className={cn(
                                  "flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center text-xs",
                                  muted,
                                )}
                              >
                                {canvasFiles.length ? (
                                  <>
                                    <span>All {canvasFiles.length} files reviewed</span>
                                  </>
                                ) : (
                                  "No changes"
                                )}
                              </div>
                            )}
                            {/* Pierre draws visible review lines; RetainedCanvas keeps each pane's geometry on tab switches. */}
                            {view !== "files" &&
                              diffDiffs &&
                              shownDiffs &&
                              (canvasView || shownDiffs.length > 0) && (
                                <Virtualizer
                                  style={{ overflowAnchor: "none" }}
                                  key={`${currentWorkspace.id}:${viewId ?? "diff"}:${range?.base ?? pr.commits?.mergeBase}:${range?.head ?? "live"}`}
                                  className={cn(
                                    "min-h-0 flex-1 overflow-auto [scroll-padding-top:var(--review-content-start)] [scroll-padding-bottom:var(--review-content-start)]",
                                  )}
                                  // Keep spacing off the scrollport: its padding also offsets sticky file headers.
                                  contentClassName="pt-[var(--review-content-start)] pb-[var(--review-content-end)]"
                                >
                                  {canvasView &&
                                    !canvasView.sections.length &&
                                    (!canvasView.guide || !diffDiffs.length) && (
                                      <div className={cn("p-4 text-xs", muted)}>
                                        Nothing in this view yet.
                                      </div>
                                    )}
                                  {(
                                    sections ?? [
                                      {
                                        title: undefined,
                                        muted: false,
                                        files: diffDiffs,
                                        parts: shownDiffs.map((d) => ({
                                          kind: "code",
                                          d,
                                          muted: false,
                                        })),
                                      },
                                    ]
                                  ).map((x, i) => (
                                    <section
                                      key={i}
                                      id={`view-section-${i}`}
                                      className={cn(
                                        x.muted && "opacity-60",
                                        // A guide's explanation and cards share a row, with room between sections.
                                        x.title !== undefined && "guide-section mb-12",
                                        divider,
                                      )}
                                    >
                                      <ProseThreads
                                        revealThread={s.thread}
                                        revealVersion={threadPicks}
                                        onThreadResolved={(id) => {
                                          if (shown.current.thread === id)
                                            void show({ thread: undefined });
                                        }}
                                        workspaceId={currentWorkspace.id}
                                        canPost={currentWorkspace.prNumber !== null}
                                        viewId={canvasView?.id ?? 0}
                                        section={i}
                                        entries={entries}
                                        turns={turns}
                                        onAsk={ask}
                                        onAnswerPermission={answerPermission}
                                      >
                                        <div
                                          className={cn(
                                            x.title !== undefined && "guide-section-layout",
                                            x.title !== undefined &&
                                              x.files.length > 0 &&
                                              guideDescriptionPosition === "beside" &&
                                              "guide-section-with-code",
                                            x.title !== undefined &&
                                              x.files.length === 0 &&
                                              "guide-section-prose-only",
                                          )}
                                        >
                                          {x.title !== undefined && (
                                            <GuideExplanation>
                                              <ViewSectionHeader
                                                title={x.title}
                                                position={
                                                  x.title !== null && canvasView
                                                    ? {
                                                        index: i + 1,
                                                        total: canvasView.sections.length,
                                                      }
                                                    : undefined
                                                }
                                                files={x.files.length}
                                                reviewed={x.files.filter(isReviewed).length}
                                                writing={!!canvasView?.writing}
                                                onReviewedChange={(on) => markSection(x.files, on)}
                                              />
                                              {(x.parts as SectionPart[]).map(
                                                (p, j) =>
                                                  p.kind === "prose" && (
                                                    <ViewProse key={j} part={j}>
                                                      {p.text}
                                                    </ViewProse>
                                                  ),
                                              )}
                                            </GuideExplanation>
                                          )}
                                          <div className="min-w-0">
                                            {(x.parts as SectionPart[]).map(
                                              (p) =>
                                                p.kind === "code" &&
                                                isShown(p.d) && (
                                                  <div
                                                    key={openedPath(p.d)}
                                                    id={`diff:${openedPath(p.d)}`}
                                                    data-reviewed={isReviewed(p.d)}
                                                    className={cn(
                                                      p.muted && !x.muted && "opacity-60",
                                                      reviewCard,
                                                      x.title === undefined && reviewGutter,
                                                      "mb-8 overflow-clip",
                                                    )}
                                                  >
                                                    <Viewer
                                                      stacked
                                                      opened={p.d}
                                                      reviewed={isReviewed(p.d)}
                                                      collapsed={isCollapsed(p.d)}
                                                      {...viewerProps(
                                                        currentWorkspace,
                                                        range?.base ?? pr.commits!.mergeBase,
                                                        range?.head,
                                                      )}
                                                    />
                                                  </div>
                                                ),
                                            )}
                                          </div>
                                        </div>
                                      </ProseThreads>
                                    </section>
                                  ))}
                                </Virtualizer>
                              )}
                          </>
                        )}
                      </div>
                    </RetainedCanvas>
                  </PreserveReviewScroll>
                )}
                <FloatingReviewButton
                  disabled={!canSubmitReview}
                  count={reviewThreads.length}
                  onPress={submitReview}
                />
              </div>
            </div>
          )}
        </div>
        {currentWorkspace && agentsOpen && (
          <>
            <Splitter fromEnd min={240} max={800} onResize={setAgentsWidth} />
            <div
              onPointerDownCapture={() => activateFindPane("chat")}
              onFocusCapture={() => activateFindPane("chat")}
              style={{ width: agentsWidth }}
              className={cn(
                "flex min-w-60 flex-col border-l pt-[var(--ui-toolbar-height)]",
                divider,
              )}
            >
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <Agents
                  key={currentWorkspace.id}
                  workspace={currentWorkspace}
                  onViewThread={viewThread}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// A part of a view section on the canvas: its markdown, or a source file or file diff it embeds.
type SectionPart = { kind: "prose"; text: string } | { kind: "code"; d: Opened; muted: boolean };

// Where the canvas is scrolled: its offset, and the file diff at its top with how far it is scrolled past.
function scrollOf(scroller: HTMLElement): Scroll {
  const box = scroller.getBoundingClientRect();
  const el = document
    .elementFromPoint(box.left + box.width / 2, box.top + 1)
    ?.closest<HTMLElement>('[id^="diff:"]');
  return el && scroller.contains(el)
    ? { top: scroller.scrollTop, anchor: el.id, offset: box.top - el.getBoundingClientRect().top }
    : { top: scroller.scrollTop, offset: 0 };
}

// Stale (ADR 0023, 0028): the worktree moved on since the view was made, by new commits or local changes. The view
// stays as it was. Above the view, not in its scroll, so it stays in sight. Update View attaches a request to make it
// again to the agent pane's composer, as New View does.
function StaleViewNotice({ onUpdate }: { onUpdate: () => void }) {
  return (
    <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-1 text-xs dark:border-amber-900 dark:bg-amber-950">
      <span className="flex-1">The Guide is updating to match the latest changes.</span>
      <Button className="py-0.5" onClick={onUpdate}>
        Update Guide…
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
      The agent is updating the Guide. Read on; more may come.
    </div>
  );
}

function GuideProgress({ workspaceId, hasGuide }: { workspaceId: number; hasGuide: boolean }) {
  const job = useQuery(core("getGuideRun", workspaceId)).data;
  if (!job || (job.state !== "running" && job.state !== "failed")) return null;
  const label = match({ state: job.state, hasGuide })
    .with({ state: "running", hasGuide: true }, () => "Updating guide…")
    .with({ state: "running", hasGuide: false }, () => "Generating guide…")
    .with({ state: "failed" }, () => "Guide update failed")
    .exhaustive();
  return (
    <div role="status" className={cn("flex shrink-0 items-center gap-2 px-4 py-2 text-xs", muted)}>
      {job.state === "running" && <SpinnerIcon />}
      <span title={job.error ?? undefined}>{label}</span>
      {job.sessionId && (
        <Button
          variant="link"
          onClick={async () => {
            if (!job.sessionId) return;
            setAgentPane(workspaceId, { picked: job.sessionId, newAgent: null });
            await window.coxswain.pickAgentSession(job.sessionId);
            await window.coxswain.setAgentPaneOpen(true);
          }}
        >
          View session
        </Button>
      )}
      {job.state === "failed" && (
        <>
          <span className="min-w-0 flex-1 truncate" title={job.error ?? undefined}>
            {job.error}
          </span>
          <Button variant="link" onClick={() => void window.coxswain.regenerateGuide(workspaceId)}>
            Retry
          </Button>
        </>
      )}
    </div>
  );
}

function UpdateGuideDialog({ workspaceId, onClose }: { workspaceId: number; onClose: () => void }) {
  const query = useQuery(core("getGuideInstructions", workspaceId));
  const settings = useQuery(core("getGuideSettings"));
  const [override, setOverride] = useState<GuideOverride>({});
  const [instructions, setInstructions] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const update = async () => {
    if (!query.isSuccess || !settings.isSuccess || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await window.coxswain.regenerateGuide(workspaceId, instructions ?? query.data, override);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };
  return (
    <Dialog
      title="Update Guide"
      subtitle="Choose what the guide should focus on."
      onClose={onClose}
    >
      <DialogBody className="flex flex-col gap-3">
        <label htmlFor="guide-instructions" className="text-[13px] font-medium">
          Guide instructions
        </label>
        <TextArea
          autoFocus
          id="guide-instructions"
          long
          rows={5}
          aria-label="Guide instructions"
          placeholder="For example: focus on architecture and data flow, with concise explanations."
          disabled={!query.isSuccess || saving}
          value={instructions ?? query.data ?? ""}
          onChange={(e) => setInstructions(e.target.value)}
          onSubmit={update}
        />
        {(error || query.isError) && (
          <ErrorText>{error ?? "Couldn’t load Guide instructions."}</ErrorText>
        )}
        <p className={cn("text-xs leading-5", muted)}>Saved for future automatic updates too.</p>
        {settings.data && (
          <div className="mt-2 border-t pt-4" style={{ borderColor: "var(--review-file-border)" }}>
            <GuideRunOptions
              workspaceId={workspaceId}
              settings={settings.data}
              value={override}
              override
              disabled={saving}
              onChange={(value) => setOverride((before) => ({ ...before, ...value }))}
            />
            <p className={cn("mt-3 text-xs", muted)}>
              Changing the agent starts a new Guide session. Model and effort overrides apply to
              this update only.
            </p>
          </div>
        )}
        {settings.isError && <ErrorText>Couldn’t load Guide defaults.</ErrorText>}
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!query.isSuccess || !settings.isSuccess || saving}
          onClick={update}
        >
          {saving ? "Starting…" : "Update Guide"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function FloatingReviewButton({
  disabled,
  count,
  onPress,
}: {
  disabled: boolean;
  count: number;
  onPress: () => void;
}) {
  const occluded = useNativeOcclusion();
  if (occluded) return null;
  const label = count ? `Submit Review (${count})` : "Submit Review";
  return (
    <div className="absolute right-3 bottom-3 z-40 w-40">
      <NativeToolbar compact controls={[{ id: "submit-review", label, disabled, onPress }]}>
        <Button
          variant="primary"
          className="min-h-8 w-full rounded-xl px-3 py-1 text-xs shadow-lg"
          disabled={disabled}
          onClick={onPress}
        >
          {label}
        </Button>
      </NativeToolbar>
    </div>
  );
}
