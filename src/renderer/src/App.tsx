import { Virtualizer } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { type UIEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangedFile, Commit } from "../../core/git";
import type { GuideGroup } from "../../core/guides";
import type { NewEntry, ReviewEntry } from "../../core/review";
import type { Workspace } from "../../core/workspaces";
import { Agents } from "./Agents";
import { upsert } from "./ChatEntry";
import { CanvasBar } from "./CanvasBar";
import { Commits } from "./Commits";
import { Button, SegmentedControl } from "./components/button";
import { Centered, Splitter, viewerMin } from "./components/layout";
import { cn, divider, muted, titleBar } from "./components/styles";
import { GuideFileNote, GuideGroupHeader } from "./GuideGroup";
import { GuideToc } from "./GuideToc";
import { Navigator, type NavigatorView } from "./Navigator";
import { NewWorkspace } from "./NewWorkspace";
import { Onboarding } from "./Onboarding";
import { Projects } from "./Projects";
import { changed, core, markReviewed as mark, queryClient } from "./queries";
import { Settings } from "./Settings";
import { Setup } from "./Setup";
import { StatusBar } from "./StatusBar";
import { usePullRequest } from "./usePullRequest";
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

  const [view, setView] = useState<NavigatorView>("diffs");
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

  const pr = usePullRequest(currentWorkspace);
  // The Commits menu: one commit's diff (its parent to it) in place of all changes.
  const [commit, setCommit] = useState<Commit | null>(null);
  useEffect(() => setCommit(null), [currentWorkspace?.id, pr.commits]);
  // The guide shown over Changes (ADR 0023), or none. The newest shows when it appears, and on opening a workspace if
  // it isn't stale. A guide and a commit are both a pinned range, so picking one drops the other.
  const guides = useQuery({
    ...core("listGuides", currentWorkspace?.id ?? 0),
    enabled: !!currentWorkspace,
  }).data;
  const [guideId, setGuideId] = useState<number | null>(null);
  const newest = useRef<{ workspaceId: number; id: number } | null>(null);
  useEffect(() => {
    if (!currentWorkspace || !guides || !pr.commits) return;
    const latest = guides[0];
    if (newest.current?.workspaceId !== currentWorkspace.id)
      setGuideId(latest?.head === pr.commits.head ? latest.id : null);
    else if (latest && latest.id !== newest.current.id) {
      setGuideId(latest.id);
      setCommit(null);
    }
    newest.current = { workspaceId: currentWorkspace.id, id: latest?.id ?? 0 };
  }, [currentWorkspace?.id, guides, pr.commits]);
  const guide = (guideId !== null && guides?.find((g) => g.id === guideId)) || null;
  const range = commit
    ? { base: commit.parent, head: commit.sha }
    : guide
      ? { base: guide.base, head: guide.head }
      : null;

  // The workspace's entries, as the canvas shows them (ADR 0015: the live diff, or the range picked). An explanation or
  // finding shows only with its guide.
  const base = range?.base ?? pr.commits?.mergeBase;
  const allEntries = useQuery({
    ...core("listEntries", currentWorkspace?.id ?? 0, base ?? "", range?.head),
    enabled: !!currentWorkspace && !!base,
  }).data;
  const entries = useMemo(
    () => allEntries?.filter((e) => !e.guideId || e.guideId === guide?.id) ?? noEntries,
    [allEntries, guide?.id],
  );
  // Callbacks handed to the Viewers are stable (useCallback), so a memoised Viewer doesn't redraw its file diff.
  // Paths of the reviewed file diffs: the live diff's, reloaded with the changes, since a file diff that changed is no
  // longer reviewed (ADR 0014); or at a guide's head, where they stay as they were.
  const mergeBase = pr.commits?.mergeBase;
  const reviewedBase = guide?.base ?? mergeBase;
  const reviewed =
    useQuery({
      ...core("listReviewed", currentWorkspace?.id ?? 0, reviewedBase ?? "", guide?.head),
      enabled: !!currentWorkspace && !!reviewedBase && !!pr.changed,
    }).data ?? noPaths;
  const markReviewed = useCallback(
    (path: string, on: boolean) =>
      void (
        currentWorkspace &&
        reviewedBase &&
        mark(currentWorkspace.id, reviewedBase, path, on, guide?.head)
      ),
    [currentWorkspace?.id, reviewedBase, guide?.head],
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
  // `opened` is a whole file picked in Files, shown on the canvas in place of the file diffs.
  const [opened, setOpened] = useState<Opened | null>(null);
  useEffect(() => setOpened(null), [currentWorkspace?.id]);
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
  // With a guide, its groups in reading order: the groups as added, the files in none, then the generated groups.
  // Groups whose file diffs are all reviewed stay listed (the table of contents shows them); the canvas skips them.
  const sections = useMemo(() => {
    if (!guide || !diffDiffs) return null;
    const byPath = new Map(diffDiffs.map((d) => [d.file.path, d]));
    const listed = new Set(guide.groups.flatMap((g) => g.paths));
    const section = (group: GuideGroup | null, ds: typeof diffDiffs) => ({
      group,
      diffs: ds,
      shown: ds.filter(isShown),
    });
    const of = (g: GuideGroup) =>
      section(
        g,
        g.paths.flatMap((p) => byPath.get(p) ?? []),
      );
    const generated = (g: GuideGroup) => g.tags.includes("generated");
    return [
      ...guide.groups.filter((g) => !generated(g)).map(of),
      section(
        null,
        diffDiffs.filter((d) => !listed.has(d.file.path)),
      ),
      ...guide.groups.filter(generated).map(of),
    ].filter((x) => x.diffs.length);
  }, [guide, diffDiffs, reviewed, viewSettings.showReviewed]);
  // The table of contents: the group at the top of the canvas's scroll, and a group picked while it was hidden (all
  // its file diffs reviewed), scrolled to once Show Reviewed Files has shown it.
  const [currentGroup, setCurrentGroup] = useState(0);
  const [pendingGroup, setPendingGroup] = useState<number | null>(null);
  const scrollToGroup = (i: number) =>
    document.getElementById(`guide-group-${i}`)?.scrollIntoView();
  useEffect(() => {
    if (pendingGroup === null) return;
    scrollToGroup(pendingGroup);
    setPendingGroup(null);
  }, [pendingGroup, viewSettings.showReviewed]);
  const pickGroup = (i: number) => {
    if (sections?.[i]?.shown.length) return scrollToGroup(i);
    setViewSettings((v) => ({ ...v, showReviewed: true }));
    setPendingGroup(i);
  };
  // The last group whose top has scrolled past the top of the canvas (with a little slack) is the current one. Only
  // the canvas's own scroll: file diffs also scroll sideways inside it.
  const onCanvasScroll = (e: UIEvent<HTMLDivElement>) => {
    const scroller = e.target as HTMLElement;
    if (!sections || scroller.parentElement !== e.currentTarget) return;
    const top = scroller.getBoundingClientRect().top + 40;
    const passed = sections.flatMap((_, i) => {
      const el = document.getElementById(`guide-group-${i}`);
      return el && el.getBoundingClientRect().top <= top ? [i] : [];
    });
    setCurrentGroup(passed.at(-1) ?? sections.findIndex((x) => x.shown.length));
  };
  // A message for the agent pane's composer, from the Guide menu; a new object each time, so the same one fills it again.
  const [composerText, setComposerText] = useState<{ text: string }>();
  const pickGuide = async () => {
    if (!currentWorkspace || !pr.commits) return;
    const picked = await window.coxswain.showGuideMenu(
      currentWorkspace.id,
      guide?.id ?? null,
      pr.commits.head,
    );
    if ("show" in picked) {
      setGuideId(picked.show);
      setCommit(null);
      setOpened(null);
      return;
    }
    // The user sends it from the agent pane; the guide shows as soon as the agent starts it.
    setComposerText({ text: picked.prompt });
  };
  const pickCommit = (picked: Commit | null) => {
    setCommit(picked);
    setGuideId(null);
    setOpened(null);
  };
  const open = (path: string) => {
    if (view === "files") return setOpened({ kind: "file", path });
    // ponytail: file diffs above it that are still loading push it down.
    document.getElementById(`diff:${path}`)?.scrollIntoView();
  };
  const showFile = view === "files" && opened;
  // Shows a thread on the canvas: back to the live file diffs, scrolled to its file, then to the thread once the
  // file diff has drawn it. ponytail: an outdated thread isn't between the lines, so this stops at its file.
  const viewThread = (threadId: number) => {
    const root = entries.find((e) => e.id === threadId);
    if (!root?.path) return;
    setOpened(null);
    setCommit(null);
    if (root.guideId) setGuideId(root.guideId);
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
            guide={guide}
            onGuide={pickGuide}
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
                          onChange={setView}
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
                        onOpen={open}
                      />
                    </>
                  )}
                </div>
                <Splitter min={240} max={720} onResize={setLeftWidth} />
              </>
            )}
            {sections && !showFile && (
              <GuideToc
                sections={sections}
                reviewed={reviewed}
                entries={entries}
                current={currentGroup}
                onPick={pickGroup}
              />
            )}
            <div
              style={{ minWidth: viewerMin }}
              className="flex min-w-0 flex-1 flex-col"
              onScrollCapture={onCanvasScroll}
            >
              {!pr.commits || !diffDiffs || !shownDiffs ? (
                <Centered>Loading…</Centered>
              ) : showFile ? (
                <Viewer opened={opened} {...viewerProps(currentWorkspace, pr.commits.mergeBase)} />
              ) : (
                // Only the lines on screen are drawn. ponytail: every file is still read from disk up front.
                <Virtualizer className="min-h-0 flex-1 overflow-auto">
                  {shownDiffs.length === 0 && (
                    <div className={cn("p-4 text-xs", muted)}>
                      {diffDiffs.length ? (
                        <>
                          All {diffDiffs.length} files reviewed.{" "}
                          <Button
                            variant="link"
                            onClick={() => setViewSettings((s) => ({ ...s, showReviewed: true }))}
                          >
                            Show them
                          </Button>
                        </>
                      ) : (
                        "No changes"
                      )}
                    </div>
                  )}
                  {guide && guide.head !== pr.commits.head && <StaleGuideNotice />}
                  {(sections ?? [{ group: undefined, diffs: diffDiffs, shown: shownDiffs }]).map(
                    (x, i) =>
                      x.shown.length > 0 && (
                        <section
                          key={i}
                          id={`guide-group-${i}`}
                          className={x.group?.tags.includes("generated") ? "opacity-60" : ""}
                        >
                          {x.group !== undefined && (
                            <GuideGroupHeader
                              group={x.group}
                              files={x.diffs.length}
                              reviewed={x.diffs.length - x.shown.length}
                            />
                          )}
                          {x.shown.map((d) => (
                            <div key={d.file.path} id={`diff:${d.file.path}`}>
                              {x.group?.notes[d.file.path] && (
                                <GuideFileNote>{x.group.notes[d.file.path]}</GuideFileNote>
                              )}
                              <Viewer
                                stacked
                                opened={d}
                                {...viewerProps(
                                  currentWorkspace,
                                  range?.base ?? pr.commits!.mergeBase,
                                  range?.head,
                                )}
                              />
                            </div>
                          ))}
                        </section>
                      ),
                  )}
                </Virtualizer>
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

// Stale (ADR 0023): the PR moved on since the guide was made. The guide stays as it was.
function StaleGuideNotice() {
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs dark:border-amber-900 dark:bg-amber-950">
      The PR has new commits since this guide. It still shows the PR as it was.
    </div>
  );
}
