import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  shell,
  type WebContents,
} from "electron";
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import icon from "../../resources/icon.png?asset";
import {
  type Agent,
  agentSessionWorkspace,
  agentAttachmentCapabilities,
  agentsBusy,
  answerPermission,
  askOnce,
  listAgentPicks,
  listTurns,
  listAgentSessions,
  newSessionAgent,
  onSessionTitle,
  type Pick,
  readAgentState,
  onSessionState,
  listAgentStatuses,
  seeAgentSessions,
  runTurn,
  formatView,
  startAgentSession,
  pickAgentSession,
  setAgentPick,
  closeWorkspaceSessions,
  stopAgents,
  stopBackgroundTask,
  stopTurn,
  steerQueued,
  unqueue,
} from "../core/agents";
import { openDatabase } from "../core/db";
import {
  prepareAttachments,
  attachmentImage,
  type Attachment,
  type AttachmentInput,
} from "../core/attachments";
import {
  cloneProject,
  listBranches,
  listChangedFiles,
  listCommits,
  listWorktreeFiles,
  openedBefore,
  openPullRequest,
  openWorktree,
  push,
  readFileAt,
  readWorktreeFile,
  snapshot,
  uncommitted,
} from "../core/git";
import { type CodeAt, findDefinitions, findUsages, stopLanguageServers } from "../core/lsp";
import { onHeadMoved, watchWorkspace } from "../core/watch";
import {
  listViews,
  onViewChange,
  removeView,
  setDiagramCheck,
  type AttachedPrompt,
  attachPrompt,
  customPrompt,
  deletePrompt,
  listPrompts,
  type Prompt,
  savePrompt,
  type ViewRange,
} from "../core/views";
import {
  type Check,
  getCurrentUser,
  listPullRequestTitles,
  listPullRequests,
  listRepos,
} from "../core/github";
import {
  changePullRequest,
  listPostable,
  postReview,
  type PullRequestChange,
  type PullRequestRef,
  readPullRequest,
  type ReviewPost,
} from "../core/pull-requests";
import { listProjects, openProject } from "../core/projects";
import {
  addNote,
  askQuestion,
  deleteEntry,
  editEntry,
  resolveThread,
  sendThread,
  getCommentToAgent,
  setCommentToAgent,
  listEntries,
  type NewEntry,
  reviewPromptText,
  sendCheck,
  sendReview,
  stopQuestion,
} from "../core/review";
import { listReviewed, setReviewed } from "../core/reviewed";
import {
  getSummarySettings,
  listSummaryJobs,
  onSummaryJobs,
  setSummaryRunner,
  setSummarySettings,
  stopInterruptedJobs,
  stopSummaryJob,
  summariseAhead,
  summaryCoverage,
  type SummarySettings,
} from "../core/summaries";
import { checkSetup } from "../core/setup";
import type { Changed, Layers, RangePick, ViewSettings } from "../preload";
import {
  listWorkspaces,
  openBranchWorkspace,
  openPullRequestWorkspace,
  openWorkspace,
  removeWorkspace,
} from "../core/workspaces";

// A run with a database of its own, e.g. a dev build checked against a scratch database: macOS ignores $HOME for
// userData, so without this a dev build migrates the installed coxswain's database ahead of it.
if (process.env.COXSWAIN_USER_DATA) app.setPath("userData", process.env.COXSWAIN_USER_DATA);

// Started from the Dock, Finder or a desktop launcher, the app gets a bare PATH without gh, claude or codex, so it takes
// the login shell's. The markers skip whatever the shell prints on start.
if (app.isPackaged && process.platform !== "win32") {
  try {
    const out = execFileSync(
      process.env.SHELL || "/bin/sh",
      ["-ilc", 'printf "__PATH__%s__PATH__" "$PATH"'],
      {
        encoding: "utf8",
        timeout: 5000,
      },
    );
    const path = /__PATH__(.*)__PATH__/.exec(out)?.[1];
    if (path) process.env.PATH = path;
  } catch {
    // Keep the PATH we got; the startup check shows what's missing.
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800, // both side panes at their minimum (240px) and the Viewer at its own (320px)
    minHeight: 500,
    show: false,
    titleBarStyle: "hiddenInset",
    icon, // Windows and Linux; macOS takes the Dock icon below
    webPreferences: { preload: join(__dirname, "../preload/index.js") },
  });
  win.once("ready-to-show", () => win.show());
  // Back and Forward before the page sees the key: the file tree takes ⌥⌘← and ⌥⌘→ for itself, so the menu's
  // accelerators never fire while it has focus.
  win.webContents.on("before-input-event", (event, input) => {
    const by = { ArrowLeft: -1, ArrowRight: 1 }[input.key];
    if (input.type !== "keyDown" || !by || !input.alt || !(input.meta || input.control)) return;
    if (input.shift) return;
    event.preventDefault();
    win.webContents.send("action", by < 0 ? "back" : "forward");
  });
  // Links in agent replies open in the browser, never in the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

// Tells the UI what the core changed on its own, so it refetches that (ADR 0017).
const changed = (to: WebContents, change: Changed) =>
  !to.isDestroyed() && to.send("changed", change);

// ponytail: macOS menu layout only; add a File > Settings entry when we ship Windows/Linux.
// ponytail: one window for now, so no focused window (e.g. the app isn't frontmost) means that one.
// The menu's items run the UI's actions by id (ADR 0027); the UI knows what each one does and when it's possible.
const runAction = (id: string) =>
  (BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0])?.webContents.send(
    "action",
    id,
  );

// ADR 0026: the view tools' diagrams are drawn in the window, which has mermaid and a DOM, and each one's error comes
// back. No window, or no answer within 15 s: not checked.
let checks = 0;
const pendingChecks = new Map<number, (errors: (string | null)[]) => void>();
ipcMain.on("diagrams:checked", (_, id: number, errors: (string | null)[]) =>
  pendingChecks.get(id)?.(errors),
);
setDiagramCheck((codes) => {
  const win = BrowserWindow.getAllWindows()[0];
  const unchecked = codes.map(() => null);
  if (!win) return Promise.resolve(unchecked);
  const id = ++checks;
  return new Promise((resolve) => {
    const done = (errors: (string | null)[]) => {
      pendingChecks.delete(id);
      clearTimeout(timer);
      resolve(errors);
    };
    const timer = setTimeout(() => done(unchecked), 15_000);
    pendingChecks.set(id, done);
    win.webContents.send("diagrams:check", id, codes);
  });
});

// Run from a build (`pnpm start`), not packaged or `pnpm dev`: Rebuild and Reload is there, to work on coxswain in
// coxswain. The agents run in the main process, so a new UI reloads the window without touching them; a new main
// process or preload needs a relaunch, which stops their turns and so asks first while one runs. Sessions resume.
const devBuild = !app.isPackaged && !process.env.ELECTRON_RENDERER_URL;
const builtMain = () =>
  createHash("sha1")
    .update(readFileSync(join(__dirname, "index.js")))
    .update(readFileSync(join(__dirname, "../preload/index.js")))
    .digest("hex");
// What this process runs, so a relaunch cancelled once is still due on the next rebuild.
const running = devBuild ? builtMain() : "";
async function rebuildAndReload() {
  const item = menu.getMenuItemById("rebuild")!;
  const wins = BrowserWindow.getAllWindows();
  item.enabled = false;
  wins.forEach((w) => w.setProgressBar(2));
  try {
    await promisify(execFile)("pnpm", ["build"], { cwd: app.getAppPath() });
  } catch (e) {
    const { stdout, stderr } = e as { stdout?: string; stderr?: string };
    dialog.showErrorBox("The build failed", (stderr || stdout || String(e)).slice(-4000));
    return;
  } finally {
    item.enabled = true;
    wins.forEach((w) => !w.isDestroyed() && w.setProgressBar(-1));
  }
  if (builtMain() === running) return wins.forEach((w) => w.webContents.reloadIgnoringCache());
  if (agentsBusy()) {
    const { response } = await dialog.showMessageBox({
      type: "warning",
      message: "Relaunch while an agent is working?",
      detail:
        "The main process or preload changed, so coxswain has to relaunch. That stops the turn in progress.",
      buttons: ["Relaunch", "Cancel"],
      defaultId: 1,
      cancelId: 1,
    });
    if (response !== 0) return;
  }
  app.relaunch();
  app.quit();
}

const menu = Menu.buildFromTemplate([
  {
    label: app.name,
    submenu: [
      { role: "about" },
      { type: "separator" },
      { label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => runAction("settings") },
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ],
  },
  {
    label: "File",
    submenu: [
      {
        label: "Open Quickly…",
        accelerator: "CmdOrCtrl+Shift+O",
        click: () => runAction("open-quickly"),
      },
      { type: "separator" },
      { role: "close" },
    ],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "pasteAndMatchStyle" },
      { role: "delete" },
      { role: "selectAll" },
      { type: "separator" },
      { label: "Find…", accelerator: "CmdOrCtrl+F", click: () => runAction("find") },
      { label: "Find Next", accelerator: "CmdOrCtrl+G", click: () => runAction("find-next") },
      {
        label: "Find Previous",
        accelerator: "CmdOrCtrl+Shift+G",
        click: () => runAction("find-previous"),
      },
    ],
  },
  {
    label: "View",
    submenu: [
      {
        label: "Command Palette…",
        accelerator: "CmdOrCtrl+K",
        click: () => runAction("command-palette"),
      },
      { type: "separator" },
      {
        label: "Toggle Navigator",
        accelerator: "CmdOrCtrl+B",
        click: () => runAction("toggle-navigator"),
      },
      { type: "separator" },
      {
        id: "back",
        label: "Back",
        accelerator: "Alt+CmdOrCtrl+Left",
        click: () => runAction("back"),
      },
      {
        id: "forward",
        label: "Forward",
        accelerator: "Alt+CmdOrCtrl+Right",
        click: () => runAction("forward"),
      },
      { type: "separator" },
      { role: "reload" },
      {
        id: "rebuild",
        label: "Rebuild and Reload",
        accelerator: "Shift+CmdOrCtrl+R",
        visible: devBuild,
        enabled: devBuild,
        click: rebuildAndReload,
      },
      { role: "toggleDevTools" },
      { type: "separator" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
      { role: "togglefullscreen" },
    ],
  },
  { role: "windowMenu" },
]);

app.whenReady().then(() => {
  // Packaged builds carry the icon in the bundle; this is for `pnpm dev`, which runs Electron's own.
  app.dock?.setIcon(icon);
  Menu.setApplicationMenu(menu);
  ipcMain.on("navigation", (_, canBack: boolean, canForward: boolean) => {
    menu.getMenuItemById("back")!.enabled = canBack;
    menu.getMenuItemById("forward")!.enabled = canForward;
  });
  const db = openDatabase(join(app.getPath("userData"), "coxswain.db"));
  ipcMain.handle("setup:check", () => checkSetup());
  ipcMain.handle("projects:list", () => listProjects(db));
  ipcMain.handle("projects:open", (_, fullName: string) => openProject(db, fullName));
  ipcMain.handle("github:current-user", () => getCurrentUser());
  ipcMain.handle("github:list-repos", (_, page: number) => listRepos(page));
  ipcMain.handle("github:list-pulls", (_, owner: string, name: string) =>
    listPullRequests(owner, name),
  );
  ipcMain.handle("github:pull-titles", (_, owner: string, name: string, numbers: number[]) =>
    listPullRequestTitles(owner, name, numbers),
  );
  ipcMain.handle("workspaces:list", (_, projectId: number) => listWorkspaces(db, projectId));
  ipcMain.handle("workspaces:open", (_, workspaceId: number) => openWorkspace(db, workspaceId));
  ipcMain.handle("workspaces:open-pr", (_, projectId: number, prNumber: number, headRef: string) =>
    openPullRequestWorkspace(db, projectId, prNumber, headRef),
  );
  ipcMain.handle(
    "workspaces:open-branch",
    (_, projectId: number, branch: string, baseBranch: string) =>
      openBranchWorkspace(db, projectId, branch, baseBranch),
  );
  ipcMain.handle("workspaces:remove", async (_, workspaceId: number) => {
    await closeWorkspaceSessions(db, workspaceId);
    await removeWorkspace(db, workspaceId);
  });
  ipcMain.handle("git:clone", (_, projectId: number) => cloneProject(db, projectId));
  ipcMain.handle("git:opened-before", (_, workspaceId: number) => openedBefore(db, workspaceId));
  // ADR 0029: a workspace opened or checked again is summarised ahead, in the background.
  ipcMain.handle("git:open-worktree", async (_, workspaceId: number) => {
    const opened = await openWorktree(db, workspaceId);
    if (opened.status === "ok") void summariseAhead(db, workspaceId);
    return opened;
  });
  // ADR 0030: the workspace on screen is watched. Its HEAD moving is a change to the worktree (commits, the diff) and
  // is summarised ahead.
  ipcMain.handle("workspaces:watch", (_, workspaceId: number | null) =>
    watchWorkspace(db, workspaceId),
  );
  onHeadMoved((workspaceId) => {
    for (const w of BrowserWindow.getAllWindows())
      changed(w.webContents, { workspaceId, what: "worktree" });
    void summariseAhead(db, workspaceId);
  });
  ipcMain.handle("git:commits", (_, workspaceId: number, mergeBase: string) =>
    listCommits(db, workspaceId, mergeBase),
  );
  ipcMain.handle("git:branches", (_, projectId: number) => listBranches(db, projectId));
  ipcMain.handle("git:snapshot", (_, workspaceId: number) => snapshot(db, workspaceId));
  ipcMain.handle("git:uncommitted", (_, workspaceId: number) => uncommitted(db, workspaceId));
  ipcMain.handle("git:push", (_, workspaceId: number) => push(db, workspaceId));
  ipcMain.handle("git:open-pull-request", async (_, workspaceId: number) => {
    const pr = await openPullRequest(db, workspaceId);
    if (pr.status === "ok") void shell.openExternal(pr.url);
    return pr;
  });
  ipcMain.handle("git:changed-files", (_, workspaceId: number, mergeBase: string, head?: string) =>
    listChangedFiles(db, workspaceId, mergeBase, head),
  );
  ipcMain.handle("git:worktree-files", (_, workspaceId: number) =>
    listWorktreeFiles(db, workspaceId),
  );
  ipcMain.handle("git:read-worktree-file", (_, workspaceId: number, path: string) =>
    readWorktreeFile(db, workspaceId, path),
  );
  ipcMain.handle("git:read-file-at", (_, workspaceId: number, commit: string, path: string) =>
    readFileAt(db, workspaceId, commit, path),
  );
  ipcMain.handle("lsp:definitions", (_, workspaceId: number, at: CodeAt) =>
    findDefinitions(db, workspaceId, at),
  );
  ipcMain.handle("lsp:usages", (_, workspaceId: number, at: CodeAt) =>
    findUsages(db, workspaceId, at),
  );
  ipcMain.handle("agents:attachment-capabilities", (_, agent: Agent) =>
    agentAttachmentCapabilities(agent),
  );
  ipcMain.handle("attachments:image", (_, bundleId: string, attachmentId: string) =>
    attachmentImage(db, bundleId, attachmentId),
  );
  ipcMain.handle("attachments:prepare", (_, inputs: AttachmentInput[]) =>
    prepareAttachments(inputs),
  );
  ipcMain.handle("attachments:pick", async () => {
    const result = await dialog.showOpenDialog({
      title: "Attach files",
      properties: ["openFile", "multiSelections"],
    });
    return result.canceled ? [] : prepareAttachments(result.filePaths.map((path) => ({ path })));
  });
  ipcMain.handle("agents:list", (_, workspaceId: number) => listAgentSessions(db, workspaceId));
  ipcMain.handle("agents:turns", (_, workspaceId: number) => listTurns(db, workspaceId));
  ipcMain.handle("agents:start", (_, workspaceId: number, agent?: Agent) =>
    startAgentSession(db, workspaceId, agent),
  );
  ipcMain.handle("agents:pick", (_, agentSessionId: string) =>
    pickAgentSession(db, agentSessionId),
  );
  ipcMain.handle("agents:new-session-agent", () => newSessionAgent(db));
  ipcMain.handle("agents:picks", (_, workspaceId: number, agent: Agent) =>
    listAgentPicks(db, workspaceId, agent),
  );
  ipcMain.handle("agents:set-pick", (_, agent: Agent, pick: Pick, value: string) =>
    setAgentPick(db, agent, pick, value),
  );
  ipcMain.handle("agents:state", (_, agentSessionId: string) => readAgentState(db, agentSessionId));
  ipcMain.handle("agents:statuses", () => listAgentStatuses(db));
  ipcMain.handle("agents:seen", (_, workspaceId: number) => seeAgentSessions(db, workspaceId));
  // Coalesce token bursts; all windows can reattach to the same core-owned session state.
  // ponytail: each notification carries the full transcript; use versioned entry deltas if long
  // sessions make IPC copying expensive.
  const pendingStates = new Map<string, Awaited<ReturnType<typeof readAgentState>>>();
  let stateTimer: ReturnType<typeof setTimeout> | undefined;
  onSessionState((id, state) => {
    pendingStates.set(id, state);
    stateTimer ??= setTimeout(() => {
      stateTimer = undefined;
      for (const window of BrowserWindow.getAllWindows())
        for (const [id, state] of pendingStates) window.webContents.send("agents:state", id, state);
      pendingStates.clear();
    }, 16);
  });
  ipcMain.handle(
    "review:list",
    (_, workspaceId: number, mergeBase: string, base: string, head?: string) =>
      listEntries(db, workspaceId, mergeBase, base, head),
  );
  ipcMain.handle("review:add-note", (_, note: NewEntry) => addNote(db, note));
  ipcMain.handle("review:delete", (_, id: number) => deleteEntry(db, id));
  // A question (review:ask), or a thread's *Send to agent* (review:send-thread: its latest note made a question, null
  // if it has none). Returns the question once saved; the reply streams as review:chat to the thread and agents:entry
  // to the agent pane, a tool use to approve comes as review:permission, waiting behind the running turn as
  // review:queued, and the turn's end as review:turn-end.
  type Handlers = Parameters<typeof sendThread> extends [unknown, unknown, ...infer H] ? H : never;
  const asking = async (
    e: Electron.IpcMainInvokeEvent,
    workspaceId: number,
    start: (...h: Handlers) => ReturnType<typeof sendThread>,
  ) => {
    const send = (channel: string, ...args: unknown[]) =>
      !e.sender.isDestroyed() && e.sender.send(channel, ...args);
    const asked = await start(
      (threadId, entry, agentSessionId) => {
        send("review:chat", threadId, entry);
        send("agents:entry", agentSessionId, entry);
      },
      (threadId, p) => permission(e.sender, () => send("review:permission", threadId, p)),
      (threadId) => send("review:queued", threadId),
    );
    if (!asked) return null;
    changed(e.sender, { workspaceId, what: "entries" }); // the question
    changed(e.sender, { workspaceId, what: "transcript" }); // the session may be new
    const threadId = asked.question.parentId ?? asked.question.id;
    asked.turn.then((result) => {
      changed(e.sender, { workspaceId, what: "entries" }); // the answer
      changed(e.sender, { workspaceId, what: "worktree" }); // the agent may have changed files
      changed(e.sender, { workspaceId, what: "transcript" });
      void summariseAhead(db, workspaceId);
      send("review:turn-end", threadId, result);
    });
    return asked.question;
  };
  ipcMain.handle("review:ask", (e, question: NewEntry) =>
    asking(e, question.workspaceId, (...h) => askQuestion(db, question, ...h)),
  );
  ipcMain.handle("review:send-thread", (e, workspaceId: number, threadId: number) =>
    asking(e, workspaceId, (...h) => sendThread(db, threadId, ...h)),
  );
  ipcMain.handle("review:resolve", (_, id: number, resolved: boolean) =>
    resolveThread(db, id, resolved),
  );
  ipcMain.handle("review:edit", (_, id: number, body: string) => editEntry(db, id, body));
  // Every thread to the agent pane's session at once; the reply streams as agents:entry, like a message sent there.
  ipcMain.handle("review:send-all", async (e, workspaceId: number) => {
    const send = (channel: string, ...args: unknown[]) =>
      !e.sender.isDestroyed() && e.sender.send(channel, ...args);
    const result = await sendReview(db, workspaceId, (agentSessionId) => {
      changed(e.sender, { workspaceId, what: "transcript" }); // the session may be new
      return {
        onEntry: (entry) => send("agents:entry", agentSessionId, entry),
        onPermission: (p) =>
          permission(e.sender, () => send("agents:permission", agentSessionId, p)),
      };
    });
    changed(e.sender, { workspaceId, what: "worktree" });
    changed(e.sender, { workspaceId, what: "transcript" });
    void summariseAhead(db, workspaceId);
    return result;
  });
  // ADR 0037: the workspace's PR for its panel, its review threads mirrored into entries on the way.
  ipcMain.handle("github:pull-request", async (e, workspaceId: number) => {
    const { pr, changed: synced } = await readPullRequest(db, workspaceId);
    if (synced) changed(e.sender, { workspaceId, what: "entries" });
    return pr;
  });
  ipcMain.handle("github:postable", (_, workspaceId: number) => listPostable(db, workspaceId));
  ipcMain.handle("github:post-review", async (e, workspaceId: number, post: ReviewPost) => {
    const result = await postReview(db, workspaceId, post);
    changed(e.sender, { workspaceId, what: "entries" }); // what got posted, also halfway
    return result;
  });
  ipcMain.handle("github:change-pr", (_, pr: PullRequestRef, change: PullRequestChange) =>
    changePullRequest(pr, change),
  );
  // A failed check to the agent pane's session; the reply streams as agents:entry, like Send to Agent's.
  ipcMain.handle("github:send-check", async (e, workspaceId: number, check: Check) => {
    const send = (channel: string, ...args: unknown[]) =>
      !e.sender.isDestroyed() && e.sender.send(channel, ...args);
    const result = await sendCheck(db, workspaceId, check, (agentSessionId) => {
      changed(e.sender, { workspaceId, what: "transcript" }); // the session may be new
      return {
        onEntry: (entry) => send("agents:entry", agentSessionId, entry),
        onPermission: (p) =>
          permission(e.sender, () => send("agents:permission", agentSessionId, p)),
      };
    });
    changed(e.sender, { workspaceId, what: "worktree" });
    changed(e.sender, { workspaceId, what: "transcript" });
    void summariseAhead(db, workspaceId);
    return result;
  });
  ipcMain.handle("review:copy-prompt", async (_, workspaceId: number) => {
    const prompt = await reviewPromptText(db, workspaceId);
    if (prompt) clipboard.writeText(prompt);
    return !!prompt;
  });
  ipcMain.handle("review:stop", (_, threadId: number) => stopQuestion(db, threadId));
  ipcMain.handle(
    "reviewed:list",
    (_, workspaceId: number, mergeBase: string, head?: string, kind?: "diff" | "file") =>
      listReviewed(db, workspaceId, mergeBase, head, kind),
  );
  ipcMain.handle(
    "reviewed:set",
    (
      _,
      workspaceId: number,
      mergeBase: string,
      path: string,
      reviewed: boolean,
      head?: string,
      kind?: "diff" | "file",
    ) => setReviewed(db, workspaceId, mergeBase, path, reviewed, head, kind),
  );
  // view: a New View prompt attached to the message, which then says what to focus on (the chat shows it as a card).
  ipcMain.handle(
    "agents:run-turn",
    async (
      e,
      agentSessionId: string,
      message: string,
      view?: AttachedPrompt,
      attachments: Attachment[] = [],
    ) => {
      const prompt = view ? formatView(view.title, message, view.prompt) : message;
      const workspaceId = await agentSessionWorkspace(db, agentSessionId);
      const send = (channel: string, ...args: unknown[]) =>
        !e.sender.isDestroyed() && e.sender.send(channel, ...args);
      const result = await runTurn(
        db,
        agentSessionId,
        prompt,
        {
          // The pane shows its own message as it sends it.
          onEntry: (entry) => entry.kind !== "user" && send("agents:entry", agentSessionId, entry),
          onPermission: (p) =>
            permission(e.sender, () => send("agents:permission", agentSessionId, p)),
        },
        attachments,
      );
      changed(e.sender, { workspaceId, what: "worktree" });
      changed(e.sender, { workspaceId, what: "transcript" });
      void summariseAhead(db, workspaceId); // the agent may have committed
      return result;
    },
  );
  // A thread's ⋯ menu. Resolves only on a click: the menu's close callback can run before the click, so it can't tell
  // a dismissal from a pick. A dismissed menu leaves the promise pending; nothing else waits on it.
  ipcMain.handle(
    "menus:thread",
    (e, can: { edit: boolean; send: boolean; delete: boolean; url: string | null }) =>
      new Promise<"edit" | "delete" | "send">((resolve) =>
        Menu.buildFromTemplate([
          { label: "Edit", enabled: can.edit, click: () => resolve("edit") },
          { label: "Delete", enabled: can.delete, click: () => resolve("delete") },
          ...(can.url
            ? [{ label: "Open on GitHub", click: () => void shell.openExternal(can.url!) }]
            : []),
          { type: "separator" },
          { label: "Send to Agent", enabled: can.send, click: () => resolve("send") },
        ]).popup({ window: BrowserWindow.fromWebContents(e.sender) ?? undefined }),
      ),
  );
  ipcMain.handle(
    "menus:view",
    (e, s: ViewSettings) =>
      new Promise<ViewSettings>((resolve) =>
        Menu.buildFromTemplate([
          {
            label: "Unified",
            type: "radio",
            checked: s.diffStyle === "unified",
            click: () => resolve({ ...s, diffStyle: "unified" }),
          },
          {
            label: "Split",
            type: "radio",
            checked: s.diffStyle === "split",
            click: () => resolve({ ...s, diffStyle: "split" }),
          },
          { type: "separator" },
          {
            label: "Show Reviewed Files",
            type: "checkbox",
            checked: s.showReviewed,
            click: () => resolve({ ...s, showReviewed: !s.showReviewed }),
          },
          { type: "separator" },
          {
            label: "Files as Tree",
            type: "radio",
            checked: s.layout === "tree",
            click: () => resolve({ ...s, layout: "tree" }),
          },
          {
            label: "Files as List",
            type: "radio",
            checked: s.layout === "list",
            click: () => resolve({ ...s, layout: "list" }),
          },
        ]).popup({ window: BrowserWindow.fromWebContents(e.sender) ?? undefined }),
      ),
  );
  // The bottom bar's Hand off: where the open threads go. Posting needs a PR, not open threads: a review can be a
  // verdict alone.
  ipcMain.handle(
    "menus:hand-off",
    (e, hasThreads: boolean, hasPr: boolean) =>
      new Promise<"agent" | "copy" | "post">((resolve) =>
        Menu.buildFromTemplate([
          { label: "Send to Agent", enabled: hasThreads, click: () => resolve("agent") },
          { label: "Copy as Prompt", enabled: hasThreads, click: () => resolve("copy") },
          { type: "separator" },
          { label: "Post to GitHub…", enabled: hasPr, click: () => resolve("post") },
        ]).popup({ window: BrowserWindow.fromWebContents(e.sender) ?? undefined }),
      ),
  );
  // The Diff tab's range: All Changes, or one of the layers it adds up to, each with how much it has and disabled when
  // empty (none checked while a commit or turn shows); or the Commits or Turns pane to pick one.
  ipcMain.handle(
    "menus:range",
    (
      e,
      scope: "all" | "pushed" | "unpushed" | "uncommitted" | null,
      hasPr: boolean,
      layers: Layers,
    ) =>
      new Promise<RangePick>((resolve) => {
        const item = (value: "all" | keyof Layers, label: string, size?: string) => ({
          label: size ? `${label} (${size})` : label,
          type: "checkbox" as const,
          checked: scope === value,
          enabled: value === "all" || scope === value || layers[value] > 0,
          click: () => resolve(value),
        });
        const n = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
        Menu.buildFromTemplate([
          item("all", "All Changes"),
          { type: "separator" },
          item("pushed", hasPr ? "In the PR" : "On GitHub", n(layers.pushed, "commit")),
          item("unpushed", "Not Pushed", n(layers.unpushed, "commit")),
          item("uncommitted", "Uncommitted", n(layers.uncommitted, "file")),
          { type: "separator" },
          { label: "Commit…", click: () => resolve("commits") },
          { label: "Agent Turn…", click: () => resolve("turns") },
        ]).popup({ window: BrowserWindow.fromWebContents(e.sender) ?? undefined });
      }),
  );
  // L1's project icon: switch to a project (the first, most recently opened, is current) or add one. Resolves only
  // on a click, like the menus above; null means Add Project.
  ipcMain.handle(
    "menus:projects",
    (e, fullNames: string[]) =>
      new Promise<string | null>((resolve) =>
        Menu.buildFromTemplate([
          ...fullNames.map((name, i) => ({
            label: name,
            type: "radio" as const,
            checked: i === 0,
            click: () => resolve(name),
          })),
          { type: "separator" },
          { label: "Add Project…", click: () => resolve(null) },
        ]).popup({ window: BrowserWindow.fromWebContents(e.sender) ?? undefined }),
      ),
  );
  // A pick from a list, e.g. the agent pane's session, agent, model and effort: one radio item per label, the checked one
  // at `checked`. Resolves with the picked index, only on a click, like the menus above.
  ipcMain.handle(
    "menus:pick",
    (e, labels: string[], checked: number) =>
      new Promise<number>((resolve) =>
        Menu.buildFromTemplate(
          labels.map((label, i) => ({
            label,
            type: "radio" as const,
            checked: i === checked,
            click: () => resolve(i),
          })),
        ).popup({ window: BrowserWindow.fromWebContents(e.sender) ?? undefined }),
      ),
  );
  // A token's context menu in the canvas. Resolves only on a click, like the menus above.
  ipcMain.handle(
    "menus:token",
    (e) =>
      new Promise<"definition" | "usages">((resolve) =>
        Menu.buildFromTemplate([
          { label: "Go to Definition", click: () => resolve("definition") },
          { label: "Find Usages", click: () => resolve("usages") },
        ]).popup({ window: BrowserWindow.fromWebContents(e.sender) ?? undefined }),
      ),
  );
  // Right-click on a view's prose (ADR 0036): Comment on the passage picked. Resolves only on Comment.
  ipcMain.handle(
    "menus:prose",
    (e) =>
      new Promise<"comment">((resolve) =>
        Menu.buildFromTemplate([
          { label: "Comment", click: () => resolve("comment") },
          { type: "separator" },
          { role: "copy" },
        ]).popup({ window: BrowserWindow.fromWebContents(e.sender) ?? undefined }),
      ),
  );
  // Definitions or usages to pick from: one item per label, then "N more" (disabled) if some didn't fit, or `none`
  // (disabled) if there are none. Resolves with the picked index, only on a click.
  ipcMain.handle(
    "menus:code-lines",
    (e, labels: string[], more: number, none: string) =>
      new Promise<number>((resolve) =>
        Menu.buildFromTemplate([
          ...(labels.length ? [] : [{ label: none, enabled: false }]),
          ...labels.map((label, i) => ({ label, click: () => resolve(i) })),
          ...(more
            ? [{ type: "separator" as const }, { label: `${more} more`, enabled: false }]
            : []),
        ]).popup({ window: BrowserWindow.fromWebContents(e.sender) ?? undefined }),
      ),
  );
  // A workspace's context menu in L1. Resolves only on a click, like the menus above.
  ipcMain.handle(
    "menus:workspace",
    (e) =>
      new Promise<"remove">((resolve) =>
        Menu.buildFromTemplate([
          { label: "Remove Workspace…", click: () => resolve("remove") },
        ]).popup({ window: BrowserWindow.fromWebContents(e.sender) ?? undefined }),
      ),
  );
  // The one confirmation for destructive actions (ADR 0004: native dialogs): a sheet on the window, true if confirmed.
  ipcMain.handle(
    "dialogs:confirm",
    async (e, c: { message: string; detail: string; action: string }) =>
      (
        await dialog.showMessageBox(BrowserWindow.fromWebContents(e.sender)!, {
          type: "warning",
          message: c.message,
          detail: c.detail,
          buttons: [c.action, "Cancel"],
          defaultId: 0,
          cancelId: 1,
        })
      ).response === 0,
  );
  ipcMain.handle("views:list", (_, workspaceId: number) => listViews(db, workspaceId));
  ipcMain.handle("views:remove", (_, viewId: number) => removeView(db, viewId));
  // A view chip's context menu in the canvas bar. Resolves only on a click, like the menus above.
  ipcMain.handle(
    "menus:view-chip",
    (e) =>
      new Promise<"remove">((resolve) =>
        Menu.buildFromTemplate([{ label: "Remove View…", click: () => resolve("remove") }]).popup({
          window: BrowserWindow.fromWebContents(e.sender) ?? undefined,
        }),
      ),
  );
  ipcMain.handle("prompts:list", () => listPrompts(db));
  ipcMain.handle("prompts:save", (_, title: string, body: string) => savePrompt(db, title, body));
  ipcMain.handle("prompts:delete", (_, id: number) => deletePrompt(db, id));
  ipcMain.handle("prompts:attach", (_, p: Prompt | null, range: ViewRange | null) =>
    attachPrompt(p ?? customPrompt, range),
  );
  // The canvas's New View menu: the built-in prompts, the user's own, New View… and New Prompt…. Resolves with the
  // prompt to attach to the agent pane's composer, or "new-prompt"; only on a click, like the menus above.
  ipcMain.handle("menus:new-view", async (e, range: ViewRange | null) => {
    const prompts = await listPrompts(db);
    return new Promise<AttachedPrompt | "new-prompt">((resolve) => {
      const item = (p: Prompt, label = p.title) => ({
        label,
        click: () => resolve(attachPrompt(p, range)),
      });
      const saved = prompts.filter((p) => p.id !== null);
      Menu.buildFromTemplate([
        ...(range
          ? [{ label: `Of ${range.what}`, enabled: false }, { type: "separator" as const }]
          : []),
        ...prompts.filter((p) => p.id === null).map((p) => item(p)),
        ...(saved.length ? [{ type: "separator" as const }, ...saved.map((p) => item(p))] : []),
        { type: "separator" },
        item(customPrompt, "New View…"),
        { label: "New Prompt…", click: () => resolve("new-prompt") },
      ]).popup({ window: BrowserWindow.fromWebContents(e.sender) ?? undefined });
    });
  });
  // ADR 0029: file summaries run on the summary agent, one-shot; Activity shows their jobs as they change.
  setSummaryRunner(({ agent, ...o }) => askOnce(agent, o));
  void stopInterruptedJobs(db);
  ipcMain.handle("summaries:jobs", () => listSummaryJobs(db));
  ipcMain.handle("summaries:coverage", (_, workspaceId: number) =>
    summaryCoverage(db, workspaceId),
  );
  ipcMain.handle("summaries:stop", (_, id: number) => stopSummaryJob(id));
  ipcMain.handle("summaries:settings", () => getSummarySettings(db));
  ipcMain.handle("summaries:set-settings", (_, s: Partial<SummarySettings>) =>
    setSummarySettings(db, s),
  );
  onSummaryJobs((jobs) => {
    for (const w of BrowserWindow.getAllWindows())
      if (!w.webContents.isDestroyed()) w.webContents.send("summaries:jobs", jobs);
  });
  ipcMain.handle("settings:comment-to-agent", () => getCommentToAgent(db));
  ipcMain.handle("settings:set-comment-to-agent", (_, toAgent: boolean) =>
    setCommentToAgent(db, toAgent),
  );
  // The agent's view tools change views and entries mid-turn; the UI refetches them as they come.
  onViewChange((workspaceId) => {
    for (const w of BrowserWindow.getAllWindows()) {
      changed(w.webContents, { workspaceId, what: "view" });
      changed(w.webContents, { workspaceId, what: "entries" });
    }
  });
  onSessionTitle(db, (workspaceId) => {
    for (const w of BrowserWindow.getAllWindows())
      changed(w.webContents, { workspaceId, what: "sessions" });
  });
  ipcMain.handle("agents:stop-turn", (_, agentSessionId: string) => stopTurn(db, agentSessionId));
  ipcMain.handle("agents:steer", (_, agentSessionId: string, queuedId: number) =>
    steerQueued(agentSessionId, queuedId),
  );
  ipcMain.handle("agents:unqueue", (_, agentSessionId: string, queuedId: number) =>
    unqueue(agentSessionId, queuedId),
  );
  ipcMain.handle("agents:stop-task", (_, agentSessionId: string, taskId: string) =>
    stopBackgroundTask(db, agentSessionId, taskId),
  );
  ipcMain.handle("agents:answer-permission", (_, id: string, optionId: string | null) =>
    answerPermission(id, optionId),
  );
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Shows a permission request and waits for the user's pick, which comes back through agents:answer-permission. A
// closed window can't answer, so the request is cancelled.
function permission(to: WebContents, show: () => void): Promise<string | null> {
  if (to.isDestroyed()) return Promise.resolve(null);
  show();
  return new Promise((resolve) => to.once("destroyed", () => resolve(null)));
}

// Stopping the adapters ends every turn still running.
app.on("will-quit", () => {
  stopAgents();
  stopLanguageServers();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
