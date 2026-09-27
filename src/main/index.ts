import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type WebContents } from "electron";
import { join } from "node:path";
import icon from "../../resources/icon.png?asset";
import {
  agentSessionWorkspace,
  answerPermission,
  listAgentSessions,
  readTranscript,
  runTurn,
  startAgentSession,
  stopAgents,
  stopTurn,
} from "../core/agents";
import { openDatabase } from "../core/db";
import {
  cloneProject,
  findDefinitions,
  findUsages,
  listChangedFiles,
  listCommits,
  listWorktreeFiles,
  openedBefore,
  openWorktree,
  readFileAt,
  readWorktreeFile,
} from "../core/git";
import { type Guide, guideRequest, listGuides, onGuideChange } from "../core/guides";
import { getCurrentUser, listPullRequests, listRepos } from "../core/github";
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
  sendReview,
  stopQuestion,
} from "../core/review";
import { listReviewed, setReviewed } from "../core/reviewed";
import { checkSetup } from "../core/setup";
import type { Changed, NavigatorSettings, ViewSettings } from "../preload";
import { listWorkspaces, openPullRequestWorkspace, removeWorkspace } from "../core/workspaces";

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

function openSettings() {
  BrowserWindow.getFocusedWindow()?.webContents.send("open-settings");
}

// ponytail: macOS menu layout only; add a File > Settings entry when we ship Windows/Linux.
// ponytail: one window for now, so no focused window (e.g. the app isn't frontmost) means that one.
const sendToWindow = (channel: string) =>
  (BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0])?.webContents.send(channel);

const menu = Menu.buildFromTemplate([
  {
    label: app.name,
    submenu: [
      { role: "about" },
      { type: "separator" },
      { label: "Settings…", accelerator: "CmdOrCtrl+,", click: openSettings },
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
        click: () => sendToWindow("open-quickly"),
      },
      { type: "separator" },
      { role: "close" },
    ],
  },
  { role: "editMenu" },
  {
    label: "View",
    submenu: [
      {
        label: "Toggle Navigator",
        accelerator: "CmdOrCtrl+B",
        click: () => sendToWindow("toggle-navigator"),
      },
      { type: "separator" },
      { role: "reload" },
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
  // ponytail: set at runtime since there's no packaging yet; build an .icns into the bundle when we package.
  app.dock?.setIcon(icon);
  Menu.setApplicationMenu(menu);
  const db = openDatabase(join(app.getPath("userData"), "coxswain.db"));
  ipcMain.handle("setup:check", () => checkSetup());
  ipcMain.handle("projects:list", () => listProjects(db));
  ipcMain.handle("projects:open", (_, fullName: string) => openProject(db, fullName));
  ipcMain.handle("github:current-user", () => getCurrentUser());
  ipcMain.handle("github:list-repos", (_, page: number) => listRepos(page));
  ipcMain.handle("github:list-pulls", (_, owner: string, name: string) =>
    listPullRequests(owner, name),
  );
  ipcMain.handle("workspaces:list", (_, projectId: number) => listWorkspaces(db, projectId));
  ipcMain.handle("workspaces:open-pr", (_, projectId: number, prNumber: number) =>
    openPullRequestWorkspace(db, projectId, prNumber),
  );
  ipcMain.handle("workspaces:remove", (_, workspaceId: number) => removeWorkspace(db, workspaceId));
  ipcMain.handle("git:clone", (_, projectId: number) => cloneProject(db, projectId));
  ipcMain.handle("git:opened-before", (_, workspaceId: number) => openedBefore(db, workspaceId));
  ipcMain.handle("git:open-worktree", (_, workspaceId: number) => openWorktree(db, workspaceId));
  ipcMain.handle("git:commits", (_, workspaceId: number, mergeBase: string) =>
    listCommits(db, workspaceId, mergeBase),
  );
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
  ipcMain.handle("git:definitions", (_, workspaceId: number, from: string, token: string) =>
    findDefinitions(db, workspaceId, from, token),
  );
  ipcMain.handle("git:usages", (_, workspaceId: number, token: string) =>
    findUsages(db, workspaceId, token),
  );
  ipcMain.handle("agents:list", (_, workspaceId: number) => listAgentSessions(db, workspaceId));
  ipcMain.handle("agents:start", (_, workspaceId: number) => startAgentSession(db, workspaceId));
  ipcMain.handle("agents:transcript", (_, agentSessionId: string) =>
    readTranscript(db, agentSessionId),
  );
  ipcMain.handle("review:list", (_, workspaceId: number, base: string, head?: string) =>
    listEntries(db, workspaceId, base, head),
  );
  ipcMain.handle("review:add-note", (_, note: NewEntry) => addNote(db, note));
  ipcMain.handle("review:delete", (_, id: number) => deleteEntry(db, id));
  // A question (review:ask), or a thread's *Send to agent* (review:send-thread: its latest note made a question, null
  // if it has none). Returns the question once saved; the reply streams as review:chat to the thread and agents:entry
  // to the agent pane, a tool use to approve comes as review:permission, and the turn's end as review:turn-end.
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
    );
    if (!asked) return null;
    changed(e.sender, { workspaceId, what: "entries" }); // the question
    changed(e.sender, { workspaceId, what: "transcript" }); // the session may be new
    const threadId = asked.question.parentId ?? asked.question.id;
    asked.turn.then((result) => {
      changed(e.sender, { workspaceId, what: "entries" }); // the answer
      changed(e.sender, { workspaceId, what: "worktree" }); // the agent may have changed files
      changed(e.sender, { workspaceId, what: "transcript" });
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
    return result;
  });
  ipcMain.handle("review:stop", (_, workspaceId: number) => stopQuestion(db, workspaceId));
  ipcMain.handle("reviewed:list", (_, workspaceId: number, mergeBase: string, head?: string) =>
    listReviewed(db, workspaceId, mergeBase, head),
  );
  ipcMain.handle(
    "reviewed:set",
    (_, workspaceId: number, mergeBase: string, path: string, reviewed: boolean, head?: string) =>
      setReviewed(db, workspaceId, mergeBase, path, reviewed, head),
  );
  ipcMain.handle("agents:run-turn", async (e, agentSessionId: string, prompt: string) => {
    const workspaceId = await agentSessionWorkspace(db, agentSessionId);
    const send = (channel: string, ...args: unknown[]) =>
      !e.sender.isDestroyed() && e.sender.send(channel, ...args);
    const result = await runTurn(db, agentSessionId, prompt, {
      // The pane shows its own message as it sends it.
      onEntry: (entry) => entry.kind !== "user" && send("agents:entry", agentSessionId, entry),
      onPermission: (p) => permission(e.sender, () => send("agents:permission", agentSessionId, p)),
    });
    changed(e.sender, { workspaceId, what: "worktree" });
    changed(e.sender, { workspaceId, what: "transcript" });
    return result;
  });
  // Resolves only on a click: the menu's close callback can run before the click, so it can't tell a dismissal
  // from a pick. A dismissed menu leaves the promise pending; nothing else waits on it.
  ipcMain.handle(
    "menus:navigator",
    (e, s: NavigatorSettings) =>
      new Promise<NavigatorSettings>((resolve) =>
        Menu.buildFromTemplate([
          {
            label: "As Tree",
            type: "radio",
            checked: s.layout === "tree",
            click: () => resolve({ ...s, layout: "tree" }),
          },
          {
            label: "As List",
            type: "radio",
            checked: s.layout === "list",
            click: () => resolve({ ...s, layout: "list" }),
          },
        ]).popup({ window: BrowserWindow.fromWebContents(e.sender) ?? undefined }),
      ),
  );
  // A thread's ⋯ menu. Resolves only on a click, like the menu above.
  ipcMain.handle(
    "menus:thread",
    (e, can: { edit: boolean; send: boolean }) =>
      new Promise<"edit" | "delete" | "send">((resolve) =>
        Menu.buildFromTemplate([
          { label: "Edit", enabled: can.edit, click: () => resolve("edit") },
          { label: "Delete", click: () => resolve("delete") },
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
        ]).popup({ window: BrowserWindow.fromWebContents(e.sender) ?? undefined }),
      ),
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
  // The agent pane's session picker: one radio item per label, the checked one at `checked`. Resolves with the picked
  // index, only on a click, like the menus above.
  ipcMain.handle(
    "menus:sessions",
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
  ipcMain.handle("guides:list", (_, workspaceId: number) => listGuides(db, workspaceId));
  // The canvas's Guide menu: a prompt for a guide, for the agent pane's composer, or which guide to show. Resolves only on a click, like the menus above.
  ipcMain.handle("menus:guide", (e, workspaceId: number, shown: number | null, prHead: string) =>
    listGuides(db, workspaceId).then(
      (guides) =>
        new Promise<{ prompt: string } | { show: number | null }>((resolve) =>
          Menu.buildFromTemplate([
            { label: "Make a Guide", click: () => resolve({ prompt: guideRequest(false) }) },
            {
              label: "Make a Guide with Review",
              click: () => resolve({ prompt: guideRequest(true) }),
            },
            { type: "separator" },
            {
              label: "No Guide",
              type: "radio",
              checked: shown === null,
              click: () => resolve({ show: null }),
            },
            ...guides.map((g: Guide) => ({
              label: `${new Date(g.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} · ${g.head.slice(0, 7)}${g.head === prHead ? "" : " (stale)"}`,
              type: "radio" as const,
              checked: g.id === shown,
              click: () => resolve({ show: g.id }),
            })),
          ]).popup({ window: BrowserWindow.fromWebContents(e.sender) ?? undefined }),
        ),
    ),
  );
  ipcMain.handle("settings:comment-to-agent", () => getCommentToAgent(db));
  ipcMain.handle("settings:set-comment-to-agent", (_, toAgent: boolean) =>
    setCommentToAgent(db, toAgent),
  );
  // The agent's guide tools change guides and entries mid-turn; the UI refetches them as they come.
  onGuideChange((workspaceId) => {
    for (const w of BrowserWindow.getAllWindows()) {
      changed(w.webContents, { workspaceId, what: "guide" });
      changed(w.webContents, { workspaceId, what: "entries" });
    }
  });
  ipcMain.handle("agents:stop-turn", (_, agentSessionId: string) => stopTurn(agentSessionId));
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
app.on("will-quit", stopAgents);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
