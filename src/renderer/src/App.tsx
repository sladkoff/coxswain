import { Virtualizer } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { type UIEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Commit } from "../../core/git";
import type { PullRequest } from "../../core/github";
import type { NewEntry, ReviewEntry } from "../../core/review";
import type { View, ViewRequest } from "../../core/views";
import type { Workspace } from "../../core/workspaces";
import { Agents } from "./Agents";
import { upsert } from "./ChatEntry";
import { CanvasBar, PaneBar, type PaneTab, viewTitles } from "./CanvasBar";
import { type Action, CommandPalette } from "./CommandPalette";
import { Commits } from "./Commits";
import { Button } from "./components/button";
import { Centered, Splitter, viewerMin } from "./components/layout";
import { cn, divider, muted, titleBar } from "./components/styles";
import { Navigator, type NavigatorView } from "./Navigator";
import { NewWorkspace } from "./NewWorkspace";
import { Onboarding } from "./Onboarding";
import { Projects } from "./Projects";
import type { CanvasSearch } from "./router";
import { changed, core, markReviewed as mark, queryClient } from "./queries";
import { Settings } from "./Settings";
import { workspaceLabel } from "./format";
import { Setup } from "./Setup";
import { StatusBar } from "./StatusBar";
import { usePullRequest } from "./usePullRequest";
import { ViewProse, ViewSectionHeader } from "./ViewSection";
import { ViewToc } from "./ViewToc";
import type { ViewSettings } from "../../preload";
import { openedPath, type Opened, type Turn, Viewer } from "./Viewer";
import { WorkspaceRail } from "./WorkspaceRail";

// Stable empty lists: a new [] each render would redraw the memoised Viewers.
const noEntries: ReviewEntry[] = [];
const noPaths: string[] = [];

export function App() {
  const [screen, setScreen] = useState<"main" | "settings" | "projects" | "new-workspace">("main");
  const close = () => setScreen("main");

  const setup = useQuery(core("checkSetup"));
  const projects = useQuery(core("listProjects")).data;
  const current = projects?.[0]; // listed most recently opened first
  const selectProject = async (fullName: string) => {
    await window.coxswain.openProject(fullName);
    await queryClient.invalidateQueries({ queryKey: ["listProjects"] });
    close();
  };

  // ponytail: pane widths reset on restart; persist them in SQLite once a settings table exists.
  const [leftWidth, setLeftWidth] = useState(416);
  const [agentsWidth, setAgentsWidth] = useState(416);
  // L1, the workspace sidebar: shown until hidden with its button, back with the agent pane's. ponytail: resets on
  // restart, like the pane widths.
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // The pane on the left of the canvas: the Navigator or the commits, under its own bar. Starts hidden; hiding it
  // keeps which one it was, for ⌘B.
  const [paneOpen, setPaneOpen] = useState(false);
  const [pane, setPane] = useState<"navigator" | "commits">("navigator");
  const showPane = (p: "navigator" | "commits") => {
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
  const currentWorkspace = workspaces.reduce<Workspace | undefined>(
    (latest, w) => (!latest || w.lastOpenedAt > latest.lastOpenedAt ? w : latest),
    undefined,
  );
  const opening = async (open: Promise<unknown>) => {
    await open;
    await queryClient.invalidateQueries({ queryKey: ["listWorkspaces", current?.id] });
    close();
  };
  const selectWorkspace = (id: number) => opening(window.coxswain.openWorkspace(id));
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
    await queryClient.invalidateQueries({ queryKey: ["listWorkspaces", w.projectId] });
  };

  // ADR 0008: clone as soon as a project is current; opening a workspace waits for it.
  const [cloning, setCloning] = useState(false);
  useEffect(() => {
    if (!current) return;
    setCloning(true);
    window.coxswain.cloneProject(current.id).finally(() => setCloning(false));
  }, [current?.id]);

  // What the canvas shows is the location's search (ADR 0025): each change is a history entry, and View > Back and
  // Forward (⌥⌘← ⌥⌘→) move through them. `s` is the current workspace's; an entry of another one, while Back or
  // Forward opens that workspace again, shows nothing of it here.
  const router = useRouter();
  const navigate = useNavigate();
  const location = useLocation();
  const search = useSearch({ from: "__root__" });
  const s: CanvasSearch = search.ws === currentWorkspace?.id ? search : {};
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
      navigate({ to: "/", search: { ...shown.current, ...changes }, replace }),
    [navigate],
  );
  const canBack = location.state.__TSR_index > 0;
  const canForward = location.state.__TSR_index < router.history.length - 1;
  useEffect(() => window.coxswain.setNavigation(canBack, canForward), [canBack, canForward]);
  // Opening a workspace is an entry of its own; Back or Forward to another workspace's entry opens that one again.
  useEffect(() => {
    if (currentWorkspace && search.ws !== currentWorkspace.id)
      void navigate({
        to: "/",
        search: { ws: currentWorkspace.id },
        replace: search.ws === undefined,
      });
  }, [currentWorkspace?.id]);
  useEffect(() => {
    const w = moved && workspaces.find((w) => w.id === search.ws);
    if (w && w.id !== currentWorkspace?.id) void selectWorkspace(w.id);
  }, [location.state.__TSR_key]);

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
  const views = useQuery({
    ...core("listViews", currentWorkspace?.id ?? 0),
    enabled: !!currentWorkspace,
  }).data;
  // On opening a workspace the newest shows in place (unless one was chosen); a new view shows as an entry of its own.
  const viewId = s.viewId ?? null;
  const newest = useRef<{ workspaceId: number; id: number } | null>(null);
  useEffect(() => {
    if (!currentWorkspace || !views || !pr.commits || !pr.snapshot) return;
    const latest = views[0];
    const now = shown.current;
    if (newest.current?.workspaceId !== currentWorkspace.id) {
      if (now.viewId === undefined && !now.commit && !now.scope && latest?.head === pr.snapshot)
        void show({ viewId: latest.id }, true);
    } else if (latest && latest.id > newest.current.id)
      void show({ viewId: latest.id, commit: undefined });
    newest.current = { workspaceId: currentWorkspace.id, id: latest?.id ?? 0 };
  }, [currentWorkspace?.id, views, pr.commits, pr.snapshot]);
  const canvasView = (viewId !== null && views?.find((v) => v.id === viewId)) || null;
  // Without either, the diff: all of it, or only what's on GitHub or only the local changes on top (ADR 0028). The
  // local changes are the live worktree, like all of it; the rest are pinned ranges.
  const scope = s.scope ?? "all";
  const range: { base: string; head?: string } | null = commit
    ? { base: commit.parent, head: commit.sha }
    : canvasView
      ? { base: canvasView.base, head: canvasView.head }
      : pr.commits && scope === "pushed"
        ? { base: pr.commits.mergeBase, head: pr.commits.head }
        : pr.commits && scope === "local"
          ? { base: pr.commits.head }
          : null;

  // The workspace's entries, as the canvas shows them (ADR 0015: the live diff, or the range picked). An explanation or
  // finding shows only with its view.
  const base = range?.base ?? pr.commits?.mergeBase;
  const allEntries = useQuery({
    ...core("listEntries", currentWorkspace?.id ?? 0, base ?? "", range?.head),
    enabled: !!currentWorkspace && !!base,
  }).data;
  const entries = useMemo(
    () => allEntries?.filter((e) => !e.viewId || e.viewId === canvasView?.id) ?? noEntries,
    [allEntries, canvasView?.id],
  );
  // Callbacks handed to the Viewers are stable (useCallback), so a memoised Viewer doesn't redraw its file diff.
  // Paths of the reviewed file diffs: the live diff's, reloaded with the changes, since a file diff that changed is no
  // longer reviewed (ADR 0014); or at a view's head, where they stay as they were.
  const mergeBase = pr.commits?.mergeBase;
  const reviewedBase = range?.base ?? mergeBase;
  const reviewed =
    useQuery({
      ...core("listReviewed", currentWorkspace?.id ?? 0, reviewedBase ?? "", range?.head),
      enabled: !!currentWorkspace && !!reviewedBase && !!pr.changed,
    }).data ?? noPaths;
  const reviewedFiles =
    useQuery({
      ...core("listReviewed", currentWorkspace?.id ?? 0, reviewedBase ?? "", range?.head, "file"),
      enabled: !!currentWorkspace && !!canvasView && !!reviewedBase,
    }).data ?? noPaths;
  const isReviewed = (opened: Opened) =>
    (opened.kind === "file" ? reviewedFiles : reviewed).includes(openedPath(opened));
  // A ticked file diff is hidden unless Show Reviewed Files is on: the next one takes its place on screen, rather than
  // everything below moving up under the scroll. Show Reviewed Files through a ref, so the callback stays stable.
  const showReviewed = useRef(viewSettings.showReviewed);
  showReviewed.current = viewSettings.showReviewed;
  const markReviewed = useCallback(
    (path: string, on: boolean, kind?: "file") => {
      if (!currentWorkspace || !reviewedBase) return;
      const scroller = canvas.current && canvasScroller(canvas.current);
      const diffs = [...(scroller?.querySelectorAll<HTMLElement>('[id^="diff:"]') ?? [])];
      const i = diffs.findIndex((el) => el.id === `diff:${path}`);
      const next = diffs[i + 1];
      mark(currentWorkspace.id, reviewedBase, path, on, range?.head, kind);
      if (!on || showReviewed.current || i < 0 || !next || !scroller) return;
      const top = scroller.getBoundingClientRect().top;
      const at = Math.max(diffs[i].getBoundingClientRect().top, top);
      restoreScroll(canvas.current!, { top: 0, anchor: next.id, offset: top - at });
    },
    [currentWorkspace?.id, reviewedBase, range?.head],
  );
  // Questions' turns by thread, kept here so they outlive the Viewer showing them. The reply streams in as chat
  // entries; once the turn ends it's an answer entry. A tool use to approve waits in permission until answered.
  const [turns, setTurns] = useState<Record<number, Turn>>({});
  useEffect(() => {
    const offChat = window.coxswain.onQuestionChat((id, c) =>
      setTurns((t) => ({
        ...t,
        [id]: {
          running: true,
          error: null,
          live: upsert(t[id]?.live ?? [], c),
          permission: t[id]?.permission ?? null,
        },
      })),
    );
    const offPermission = window.coxswain.onQuestionPermission((id, permission) =>
      setTurns((t) => ({
        ...t,
        [id]: { running: true, error: null, live: t[id]?.live ?? [], permission },
      })),
    );
    // The answer entry comes with the core's change event, just before this.
    const offEnd = window.coxswain.onQuestionEnd((id, result) =>
      setTurns((t) => ({
        ...t,
        [id]: {
          running: false,
          error: result.status === "error" ? result.message : null,
          live: [],
          permission: null,
        },
      })),
    );
    return () => {
      offChat();
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
        error: null,
        live: t[id]?.live ?? [],
        permission: t[id]?.permission ?? null,
      },
    }));
    changed({ workspaceId: q.workspaceId, what: "entries" });
  }, []);
  // `opened` is a whole file picked in Files, shown on the canvas in place of the file diffs. Memoised: the Viewer
  // rereads when its Opened changes.
  const line = moved ? undefined : s.line;
  const opened = useMemo<Opened | null>(
    () => (s.file ? { kind: "file", path: s.file, line } : null),
    [s.file, line],
  );
  // Each entry keeps where the canvas was scrolled, restored on Back and Forward. For the file diffs also the one at
  // the top: those above it may have been read (and grown) since, so the offset alone would land elsewhere.
  const canvas = useRef<HTMLDivElement>(null);
  const scrolls = useRef(new Map<string, Scroll>());
  const entry = () => router.history.location.state.__TSR_key ?? "";
  useEffect(() => {
    const key = location.state.__TSR_key ?? "";
    const saved = scrolls.current.get(key);
    const scroller = canvas.current && canvasScroller(canvas.current);
    if (!moved) {
      if (!saved && scroller) scrolls.current.set(key, scrollOf(scroller));
    } else if (saved && canvas.current) restoreScroll(canvas.current, saved);
  }, [location.state.__TSR_key]);
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
  // Reviewed file diffs are hidden unless Show Reviewed Files is on, as in the Navigator.
  const isShown = (d: Opened) => viewSettings.showReviewed || !isReviewed(d);
  const shownDiffs = useMemo(
    () => diffDiffs?.filter(isShown),
    [diffDiffs, reviewed, viewSettings.showReviewed],
  );
  // With a view, its sections in order: prose and the file diffs it embeds; for a guide, then the files in none.
  // Sections whose file diffs are all reviewed stay listed (the table of contents shows them); the canvas skips them.
  const sections = useMemo(() => {
    if (!canvasView || !diffDiffs) return null;
    const byPath = new Map(diffDiffs.map((d) => [d.file.path, d]));
    const section = (title: string | null, parts: SectionPart[], generated: boolean) => {
      const files = parts.flatMap((p) => (p.kind === "code" ? [p.d] : []));
      return { title, parts, generated, files, shown: files.filter(isShown) };
    };
    const listed = new Set<string>();
    const all = canvasView.sections.map((x) => {
      const parts = x.parts.flatMap((p): SectionPart[] => {
        if (p.kind === "prose") return [p];
        const d: Opened | undefined =
          p.kind === "file" ? { kind: "file", path: p.path } : byPath.get(p.path);
        if (!d) return [];
        if (p.kind === "diff") listed.add(p.path);
        return [{ kind: "code", d, generated: p.generated }];
      });
      const embeds = parts.filter((p) => p.kind === "code");
      return section(x.title, parts, embeds.length > 0 && embeds.every((p) => p.generated));
    });
    const rest = diffDiffs.filter((d) => !listed.has(d.file.path));
    if (canvasView.guide && rest.length)
      all.push(
        section(
          null,
          rest.map((d) => ({ kind: "code", d, generated: false })),
          false,
        ),
      );
    return all;
  }, [canvasView, diffDiffs, reviewed, reviewedFiles, viewSettings.showReviewed]);
  const canvasFiles = sections?.flatMap((s) => s.files) ?? diffDiffs ?? [];
  // The table of contents: the section at the top of the canvas's scroll, and a section picked while it was hidden
  // (all its file diffs reviewed), scrolled to once Show Reviewed Files has shown it.
  const [currentSection, setCurrentSection] = useState(0);
  const [pendingSection, setPendingSection] = useState<number | null>(null);
  const scrollToSection = (i: number) =>
    document.getElementById(`view-section-${i}`)?.scrollIntoView();
  useEffect(() => {
    if (pendingSection === null) return;
    scrollToSection(pendingSection);
    setPendingSection(null);
  }, [pendingSection, viewSettings.showReviewed]);
  const pickSection = (i: number) => {
    if (sections?.[i] && sectionShown(sections[i])) return scrollToSection(i);
    setViewSettings((v) => ({ ...v, showReviewed: true }));
    setPendingSection(i);
  };
  // The last section whose top has scrolled past the top of the canvas (with a little slack) is the current one. Only
  // the canvas's own scroll: file diffs also scroll sideways inside it.
  const onCanvasScroll = (e: UIEvent<HTMLDivElement>) => {
    const scroller = e.target as HTMLElement;
    if (scroller.parentElement !== e.currentTarget) return;
    scrolls.current.set(entry(), scrollOf(scroller));
    if (!sections) return;
    const top = scroller.getBoundingClientRect().top + 40;
    const passed = sections.flatMap((_, i) => {
      const el = document.getElementById(`view-section-${i}`);
      return el && el.getBoundingClientRect().top <= top ? [i] : [];
    });
    setCurrentSection(passed.at(-1) ?? sections.findIndex(sectionShown));
  };
  // A message for the agent pane's composer, from the new view menu; a new object each time, so the same one fills it
  // again. The user sends it from the agent pane; the view shows as soon as the agent starts it.
  const [composerText, setComposerText] = useState<{ text: string }>();
  // Its explanations and findings go with it; showing it, the canvas falls back to the diff.
  const removeView = async (v: View, label: string) => {
    const ok = await window.coxswain.confirm({
      message: `Remove the view “${label}”?`,
      detail: "Its sections, explanations and findings are deleted.",
      action: "Remove",
    });
    if (!ok) return;
    await window.coxswain.removeView(v.id);
    await changed({ workspaceId: v.workspaceId, what: "view" });
    await changed({ workspaceId: v.workspaceId, what: "entries" });
  };
  const newView = async () => setComposerText({ text: await window.coxswain.showNewViewMenu() });
  const showView = (id: number | null) =>
    void show({ viewId: id, commit: undefined, file: undefined, at: undefined });
  const pickCommit = (picked: Commit | null) =>
    void show({ commit: picked ?? undefined, viewId: null, file: undefined, at: undefined });
  // The pane's bar: Changes and Files are the Navigator's toggle (a history entry, ADR 0025), Commits the other pane.
  const paneTab: PaneTab = pane === "commits" ? "commits" : view;
  const pickPaneTab = (t: PaneTab) => {
    setPane(t === "commits" ? "commits" : "navigator");
    if (t !== "commits" && t !== view) void show({ view: t === "files" ? "files" : undefined });
  };
  const pickScope = (picked: "all" | "pushed" | "local") =>
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
    await queryClient.invalidateQueries({ queryKey: ["openWorktree", w.id] });
    await queryClient.invalidateQueries({ queryKey: ["listWorkspaces", w.projectId] });
    await changed({ workspaceId: w.id, what: "worktree" });
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
    (path: string, line?: number) => {
      showPane("navigator");
      // The same file again without a line (e.g. the tree selecting the one it revealed) is no new entry.
      const now = shown.current;
      if (!line && now.view === "files" && now.file === path) return;
      void show({ view: "files", file: path, line, at: undefined });
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
  // Shows a thread on the canvas: back to the live file diffs, scrolled to its file, then to the thread once the
  // file diff has drawn it. ponytail: an outdated thread isn't between the lines, so this stops at its file.
  const viewThread = async (threadId: number) => {
    const root = entries.find((e) => e.id === threadId);
    if (!root?.path) return;
    await show({
      file: undefined,
      at: undefined,
      commit: undefined,
      viewId: root.viewId ?? shown.current.viewId,
    });
    document.getElementById(`diff:${root.path}`)?.scrollIntoView();
    let tries = 20;
    const find = () => {
      const el = document.getElementById(`thread:${threadId}`);
      if (el) el.scrollIntoView({ block: "center" });
      else if (tries--) setTimeout(find, 50);
    };
    find();
  };

  // The action registry (ADR 0027): everything the command palette lists and the native menu runs, by id. Rebuilt each
  // render, so each action's enabled and run see the current state.
  const onMain = screen === "main" && !!current && palette === null;
  const ready = !!currentWorkspace && !!pr.commits;
  const titles = viewTitles(views ?? []);
  const newViewAction = (kind: ViewRequest, title: string): Action => ({
    id: `new-view:${kind}`,
    title,
    enabled: ready,
    run: async () => setComposerText({ text: await window.coxswain.newViewRequest(kind) }),
  });
  const actions: Action[] = [
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
            : "Show Only Pushed Changes",
        ],
        ["local", "Show Only Local Changes"],
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
    newViewAction("guide", "New View (guide)"),
    newViewAction("review", "New View (review)"),
    newViewAction("data model", "New View (data model)"),
    newViewAction("data flow", "New View (data flow)"),
    newViewAction("custom", "New View…"),
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
  });

  if (!setup.data) return null; // local and quick, like the projects below
  if (setup.data.problems.length)
    return <Setup check={setup.data} onRetry={() => void setup.refetch()} />;
  if (screen === "settings") return <Settings onClose={close} />;
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
            style={{ width: agentsWidth }}
            className={cn("flex min-w-60 flex-col border-r", divider)}
          >
            <Agents
              key={currentWorkspace.id}
              workspace={currentWorkspace}
              onViewThread={viewThread}
              composerText={composerText}
              onShowSidebar={sidebarOpen ? undefined : () => setSidebarOpen(true)}
            />
          </div>
          <Splitter min={240} max={800} onResize={setAgentsWidth} />
        </>
      )}

      {/* The canvas: what the agent and the human look at together. For now, the workspace's file diffs. */}
      <div style={{ minWidth: viewerMin }} className="flex min-w-0 flex-1 flex-col">
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
                  {paneTab === "commits" ? (
                    pr.commits && (
                      <Commits
                        workspaceId={currentWorkspace.id}
                        mergeBase={pr.commits.mergeBase}
                        head={pr.commits.head}
                        canOpenPr={currentWorkspace.prNumber === null}
                        problem={gitProblem}
                        current={commit}
                        onPick={pickCommit}
                        onPush={() => void push(currentWorkspace)}
                        onOpenPullRequest={() => void openPullRequest(currentWorkspace)}
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
                paneOpen={paneOpen}
                onShowPane={() => setPaneOpen(true)}
                ready={!!pr.commits}
                commit={commit}
                view={canvasView}
                views={views ?? []}
                snapshot={pr.snapshot}
                scope={scope}
                hasPr={currentWorkspace.prNumber !== null}
                onRangeMenu={async () => {
                  const picked = await window.coxswain.showRangeMenu(
                    commit ? null : scope,
                    currentWorkspace.prNumber !== null,
                  );
                  if (picked === "commits") showPane("commits");
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
                onViewOptions={async () =>
                  setViewSettings(await window.coxswain.showViewMenu(viewSettings))
                }
              />
              <div className="flex min-h-0 flex-1">
                {sections && !showFile && (
                  <ViewToc
                    sections={sections}
                    reviewed={reviewed}
                    reviewedFiles={reviewedFiles}
                    entries={entries}
                    current={currentSection}
                    onPick={pickSection}
                  />
                )}
                <div
                  style={{ minWidth: viewerMin }}
                  className="flex min-w-0 flex-1 flex-col"
                  ref={canvas}
                  onScrollCapture={onCanvasScroll}
                >
                  {!pr.commits || !diffDiffs || !shownDiffs ? (
                    <Centered>Loading…</Centered>
                  ) : (
                    <>
                      {showFile && (
                        // One Viewer per file: a reused one would scroll to a line in the file it drew before.
                        <Viewer
                          key={opened.kind === "file" ? opened.path : undefined}
                          opened={opened}
                          reviewed={false}
                          {...viewerProps(currentWorkspace, pr.commits.mergeBase)}
                        />
                      )}
                      {/* Only the lines on screen are drawn. Hidden, not unmounted, under a whole file: it keeps its
                      scroll and read files for Back. ponytail: every file is still read from disk up front. */}
                      <Virtualizer
                        className={cn("min-h-0 flex-1 overflow-auto", showFile && "hidden")}
                      >
                        {canvasView &&
                        !canvasView.sections.length &&
                        (!canvasView.guide || !diffDiffs.length) ? (
                          <div className={cn("p-4 text-xs", muted)}>Nothing in this view yet.</div>
                        ) : (
                          (!canvasView || canvasFiles.length > 0) &&
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
                        {canvasView && pr.snapshot && canvasView.head !== pr.snapshot && (
                          <StaleViewNotice />
                        )}
                        {(
                          sections ?? [
                            {
                              title: undefined,
                              generated: false,
                              files: diffDiffs,
                              shown: shownDiffs,
                              parts: shownDiffs.map((d) => ({ kind: "code", d, generated: false })),
                            },
                          ]
                        ).map(
                          (x, i) =>
                            sectionShown(x) && (
                              <section
                                key={i}
                                id={`view-section-${i}`}
                                className={x.generated ? "opacity-60" : ""}
                              >
                                {x.title !== undefined && (
                                  <ViewSectionHeader
                                    title={x.title}
                                    files={x.files.length}
                                    reviewed={x.files.filter(isReviewed).length}
                                    generated={x.generated}
                                  />
                                )}
                                {(x.parts as SectionPart[]).map((p, j) =>
                                  p.kind === "prose" ? (
                                    <ViewProse key={j}>{p.text}</ViewProse>
                                  ) : (
                                    isShown(p.d) && (
                                      <div
                                        key={openedPath(p.d)}
                                        id={`diff:${openedPath(p.d)}`}
                                        className={p.generated && !x.generated ? "opacity-60" : ""}
                                      >
                                        <Viewer
                                          stacked
                                          opened={p.d}
                                          reviewed={isReviewed(p.d)}
                                          {...viewerProps(
                                            currentWorkspace,
                                            range?.base ?? pr.commits!.mergeBase,
                                            range?.head,
                                          )}
                                        />
                                      </div>
                                    )
                                  ),
                                )}
                              </section>
                            ),
                        )}
                      </Virtualizer>
                    </>
                  )}
                </div>
              </div>
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
          />
        )}
      </div>
    </div>
  );
}

// A part of a view section on the canvas: its markdown, or a source file or file diff it embeds.
type SectionPart =
  | { kind: "prose"; text: string }
  | { kind: "code"; d: Opened; generated: boolean };
// A section shows unless all its files and diffs are hidden (reviewed); one with none always does.
const sectionShown = (x: { files: unknown[]; shown: unknown[] }) =>
  !x.files.length || x.shown.length > 0;

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
  const go = () => {
    const scroller = canvasScroller(canvas);
    const el = s.anchor ? document.getElementById(s.anchor) : null;
    const ready = s.anchor
      ? el
      : scroller && scroller.scrollHeight - scroller.clientHeight >= s.top;
    if (!ready && tries-- > 0) return void setTimeout(go, 50);
    if (!scroller) return;
    const by = el
      ? el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + s.offset
      : s.top - scroller.scrollTop;
    if (Math.abs(by) < 2) return;
    scroller.scrollTop += by;
    if (tries-- > 0) setTimeout(go, 50);
  };
  setTimeout(go);
}

// Stale (ADR 0023, 0028): the worktree moved on since the view was made, by new commits or local changes. The view
// stays as it was.
function StaleViewNotice() {
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs dark:border-amber-900 dark:bg-amber-950">
      The code has changed since this view. It still shows the changes as they were.
    </div>
  );
}
