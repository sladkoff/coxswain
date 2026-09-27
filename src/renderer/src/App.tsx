import { Virtualizer } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { type UIEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangedFile, Commit } from "../../core/git";
import type { NewEntry, ReviewEntry } from "../../core/review";
import type { Workspace } from "../../core/workspaces";
import { Agents } from "./Agents";
import { upsert } from "./ChatEntry";
import { CanvasBar } from "./CanvasBar";
import { Commits } from "./Commits";
import { Button, SegmentedControl } from "./components/button";
import { Centered, Splitter, viewerMin } from "./components/layout";
import { cn, divider, muted, titleBar } from "./components/styles";
import { Navigator, type NavigatorView } from "./Navigator";
import { NewWorkspace } from "./NewWorkspace";
import { Onboarding } from "./Onboarding";
import { OpenQuickly } from "./OpenQuickly";
import { Projects } from "./Projects";
import type { CanvasSearch } from "./router";
import { changed, core, markReviewed as mark, queryClient } from "./queries";
import { Settings } from "./Settings";
import { Setup } from "./Setup";
import { StatusBar } from "./StatusBar";
import { usePullRequest } from "./usePullRequest";
import { ViewProse, ViewSectionHeader } from "./ViewSection";
import { ViewToc } from "./ViewToc";
import type { ViewSettings } from "../../preload";
import { type Opened, type Turn, Viewer } from "./Viewer";
import { WorkspaceRail } from "./WorkspaceRail";

// Stable empty lists: a new [] each render would redraw the memoised Viewers.
const noEntries: ReviewEntry[] = [];
const noPaths: string[] = [];

export function App() {
  const [screen, setScreen] = useState<"main" | "settings" | "projects" | "new-workspace">("main");
  useEffect(() => window.coxswain.onOpenSettings(() => setScreen("settings")), []);
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
  // The pane on the left of the canvas: the Navigator (files) or the commits. Starts hidden.
  const [leftPane, setLeftPane] = useState<"files" | "commits" | null>(null);
  const toggleLeftPane = (p: "files" | "commits") => setLeftPane((o) => (o === p ? null : p));
  useEffect(() => window.coxswain.onToggleNavigator(() => toggleLeftPane("files")), []);

  // ponytail: resets on restart, like the Navigator's settings; store them once there's a settings table.
  const [viewSettings, setViewSettings] = useState<ViewSettings>({
    diffStyle: "unified",
    showReviewed: false,
  });
  const workspaces =
    useQuery({ ...core("listWorkspaces", current?.id ?? 0), enabled: !!current }).data ?? [];
  const currentWorkspace = workspaces.reduce<Workspace | undefined>(
    (latest, w) => (!latest || w.lastOpenedAt > latest.lastOpenedAt ? w : latest),
    undefined,
  );
  const selectWorkspace = async (prNumber: number) => {
    if (!current) return;
    await window.coxswain.openPullRequestWorkspace(current.id, prNumber);
    await queryClient.invalidateQueries({ queryKey: ["listWorkspaces", current.id] });
    close();
  };

  // The workspace's entries, reviewed files and agent sessions go with it; its worktree stays on disk.
  const removeWorkspace = async (w: Workspace) => {
    const ok = await window.coxswain.confirm({
      message: `Remove PR #${w.prNumber} from the sidebar?`,
      detail:
        "Its comments, reviewed files and agent sessions are deleted. The worktree stays on disk, and adding the PR again reuses it.",
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
  useEffect(
    () =>
      window.coxswain.onNavigate((by) =>
        by < 0 ? router.history.back() : router.history.forward(),
      ),
    [router],
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
    if (w && w.id !== currentWorkspace?.id) void selectWorkspace(w.prNumber);
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
    if (!currentWorkspace || !views || !pr.commits) return;
    const latest = views[0];
    const now = shown.current;
    if (newest.current?.workspaceId !== currentWorkspace.id) {
      if (now.viewId === undefined && !now.commit && latest?.head === pr.commits.head)
        void show({ viewId: latest.id }, true);
    } else if (latest && latest.id !== newest.current.id)
      void show({ viewId: latest.id, commit: undefined });
    newest.current = { workspaceId: currentWorkspace.id, id: latest?.id ?? 0 };
  }, [currentWorkspace?.id, views, pr.commits]);
  const canvasView = (viewId !== null && views?.find((v) => v.id === viewId)) || null;
  const range = commit
    ? { base: commit.parent, head: commit.sha }
    : canvasView
      ? { base: canvasView.base, head: canvasView.head }
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
  const reviewedBase = canvasView?.base ?? mergeBase;
  const reviewed =
    useQuery({
      ...core("listReviewed", currentWorkspace?.id ?? 0, reviewedBase ?? "", canvasView?.head),
      enabled: !!currentWorkspace && !!reviewedBase && !!pr.changed,
    }).data ?? noPaths;
  const markReviewed = useCallback(
    (path: string, on: boolean) =>
      void (
        currentWorkspace &&
        reviewedBase &&
        mark(currentWorkspace.id, reviewedBase, path, on, canvasView?.head)
      ),
    [currentWorkspace?.id, reviewedBase, canvasView?.head],
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
  const isShown = (d: { file: ChangedFile }) =>
    viewSettings.showReviewed || !reviewed.includes(d.file.path);
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
      const diffs = parts.flatMap((p) => (p.kind === "diff" ? [p.d] : []));
      return { title, parts, generated, diffs, shown: diffs.filter(isShown) };
    };
    const listed = new Set<string>();
    const all = canvasView.sections.map((x) => {
      const parts = x.parts.flatMap((p): SectionPart[] => {
        if (p.kind === "prose") return [p];
        const d = byPath.get(p.path);
        if (!d) return [];
        listed.add(p.path);
        return [{ kind: "diff", d, generated: p.generated }];
      });
      const embeds = parts.filter((p) => p.kind === "diff");
      return section(x.title, parts, embeds.length > 0 && embeds.every((p) => p.generated));
    });
    const rest = diffDiffs.filter((d) => !listed.has(d.file.path));
    if (canvasView.guide && rest.length)
      all.push(
        section(
          null,
          rest.map((d) => ({ kind: "diff", d, generated: false })),
          false,
        ),
      );
    return all;
  }, [canvasView, diffDiffs, reviewed, viewSettings.showReviewed]);
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
  const newView = async () => setComposerText({ text: await window.coxswain.showNewViewMenu() });
  const pickCommit = (picked: Commit | null) =>
    void show({ commit: picked ?? undefined, viewId: null, file: undefined, at: undefined });
  // The one way to show a whole file: on the canvas, at `line` if given, with the Navigator on Files and the file
  // revealed there. Files, Open Quickly, Go to Definition and Find Usages all go through it. Stable, so the memoised
  // Viewers don't all redraw.
  const openFile = useCallback(
    (path: string, line?: number) => {
      setLeftPane("files");
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
  // Open Quickly (⌘⇧O): any file of the worktree, shown on the canvas with the Navigator on Files.
  const [quickOpen, setQuickOpen] = useState(false);
  useEffect(() => window.coxswain.onOpenQuickly(() => setQuickOpen(true)), []);
  const openQuickly = (path: string) => {
    setQuickOpen(false);
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

  const viewerProps = (workspace: Workspace, mergeBase: string, head?: string) => ({
    workspace,
    mergeBase,
    head,
    entries,
    reviewed,
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
  if (screen === "projects")
    return (
      <Projects
        projects={projects ?? []}
        current={current}
        onSelect={selectProject}
        onClose={close}
      />
    );
  if (screen === "new-workspace" && current)
    return (
      <NewWorkspace
        project={current}
        openPrNumbers={workspaces.map((w) => w.prNumber)}
        onSelect={selectWorkspace}
        onClose={close}
      />
    );
  if (!projects) return null; // local and near-instant, so no loading screen
  if (!current)
    return (
      <Onboarding
        onSettings={() => setScreen("settings")}
        onChooseProject={() => setScreen("projects")}
      />
    );

  // Empty shell of the main screen from docs/UX.md: L1 project and workspaces, the agent pane, the canvas.
  return (
    // Side panes keep their dragged width but shrink with the window before the Viewer goes below viewerMin.
    <div className="flex h-full select-none overflow-hidden text-sm">
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
        onSelect={selectWorkspace}
        onRemove={removeWorkspace}
        onNew={() => setScreen("new-workspace")}
      />

      {currentWorkspace && quickOpen && (
        <OpenQuickly
          workspaceId={currentWorkspace.id}
          onOpen={openQuickly}
          onClose={() => setQuickOpen(false)}
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
            />
          </div>
          <Splitter min={240} max={800} onResize={setAgentsWidth} />
        </>
      )}

      {/* The canvas: what the agent and the human look at together. For now, the workspace's file diffs. */}
      <div style={{ minWidth: viewerMin }} className="flex min-w-0 flex-1 flex-col">
        {currentWorkspace ? (
          <CanvasBar
            files={diffPr.changed?.length}
            leftPane={leftPane}
            onToggleLeftPane={toggleLeftPane}
            ready={!!pr.commits}
            commit={commit}
            view={canvasView}
            views={views ?? []}
            prHead={pr.commits?.head}
            onShowView={(id) =>
              void show({ viewId: id, commit: undefined, file: undefined, at: undefined })
            }
            onNewView={newView}
            onOpenQuickly={() => setQuickOpen(true)}
            canBack={canBack}
            canForward={canForward}
            onBack={() => router.history.back()}
            onForward={() => router.history.forward()}
            onViewOptions={async () =>
              setViewSettings(await window.coxswain.showViewMenu(viewSettings))
            }
          />
        ) : (
          <div className={cn(titleBar, "border-b", divider)} />
        )}
        {!currentWorkspace ? (
          <Centered>No workspace. Start one with +</Centered>
        ) : (
          <div className="flex min-h-0 flex-1">
            {leftPane && (
              <>
                <div
                  style={{ width: leftWidth }}
                  className={cn("flex min-w-60 flex-col border-r", divider)}
                >
                  {leftPane === "commits" ? (
                    pr.commits && (
                      <Commits
                        workspaceId={currentWorkspace.id}
                        mergeBase={pr.commits.mergeBase}
                        current={commit}
                        onPick={pickCommit}
                      />
                    )
                  ) : (
                    <>
                      <div className="flex shrink-0 justify-end px-2 pt-1.5">
                        <SegmentedControl
                          value={view}
                          onChange={(v) => void show({ view: v === "files" ? "files" : undefined })}
                          options={[
                            { value: "diffs", label: "Diffs" },
                            { value: "files", label: "Files" },
                          ]}
                        />
                      </div>
                      <Navigator
                        key={currentWorkspace.id}
                        workspace={currentWorkspace}
                        pr={diffPr}
                        view={view}
                        reviewed={reviewed}
                        showReviewed={viewSettings.showReviewed}
                        entries={entries}
                        selected={opened?.kind === "file" ? opened.path : undefined}
                        onOpen={open}
                      />
                    </>
                  )}
                </div>
                <Splitter min={240} max={720} onResize={setLeftWidth} />
              </>
            )}
            {sections && !showFile && (
              <ViewToc
                sections={sections}
                reviewed={reviewed}
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
                      {...viewerProps(currentWorkspace, pr.commits.mergeBase)}
                    />
                  )}
                  {/* Only the lines on screen are drawn. Hidden, not unmounted, under a whole file: it keeps its
                      scroll and read files for Back. ponytail: every file is still read from disk up front. */}
                  <Virtualizer className={cn("min-h-0 flex-1 overflow-auto", showFile && "hidden")}>
                    {canvasView && !canvasView.guide && !canvasView.sections.length ? (
                      <div className={cn("p-4 text-xs", muted)}>Nothing in this view yet.</div>
                    ) : (
                      (!canvasView || canvasView.guide) &&
                      shownDiffs.length === 0 && (
                        <div className={cn("p-4 text-xs", muted)}>
                          {diffDiffs.length ? (
                            <>
                              All {diffDiffs.length} files reviewed.{" "}
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
                    {canvasView && canvasView.head !== pr.commits.head && <StaleViewNotice />}
                    {(
                      sections ?? [
                        {
                          title: undefined,
                          generated: false,
                          diffs: diffDiffs,
                          shown: shownDiffs,
                          parts: shownDiffs.map((d) => ({ kind: "diff", d, generated: false })),
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
                                files={x.diffs.length}
                                reviewed={x.diffs.length - x.shown.length}
                                generated={x.generated}
                              />
                            )}
                            {(x.parts as SectionPart[]).map((p, j) =>
                              p.kind === "prose" ? (
                                <ViewProse key={j}>{p.text}</ViewProse>
                              ) : (
                                isShown(p.d) && (
                                  <div
                                    key={p.d.file.path}
                                    id={`diff:${p.d.file.path}`}
                                    className={p.generated && !x.generated ? "opacity-60" : ""}
                                  >
                                    <Viewer
                                      stacked
                                      opened={p.d}
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
        )}
        {currentWorkspace && diffPr.changed && (
          <StatusBar
            workspaceId={currentWorkspace.id}
            entries={entries}
            files={diffPr.changed}
            reviewed={reviewed}
            turns={turns}
            onViewThread={viewThread}
          />
        )}
      </div>
    </div>
  );
}

// A part of a view section on the canvas: its markdown, or a file diff it embeds.
type SectionPart =
  | { kind: "prose"; text: string }
  | { kind: "diff"; d: { kind: "diff"; file: ChangedFile }; generated: boolean };
// A section shows unless all its file diffs are hidden (reviewed); one with none always does.
const sectionShown = (x: { diffs: unknown[]; shown: unknown[] }) =>
  !x.diffs.length || x.shown.length > 0;

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

// Stale (ADR 0023): the PR moved on since the view was made. The view stays as it was.
function StaleViewNotice() {
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs dark:border-amber-900 dark:bg-amber-950">
      The PR has new commits since this view. It still shows the PR as it was.
    </div>
  );
}
