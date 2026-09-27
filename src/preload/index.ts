import { contextBridge, ipcRenderer } from "electron";
import type {
  Agent,
  AgentPicks,
  AgentSession,
  ChatEntry,
  Permission,
  Pick,
  TurnResult,
} from "../core/agents";
import type {
  ChangedFileList,
  CloneResult,
  Commit,
  CodeLineList,
  FileText,
  FileTreeResult,
  GitProblem,
  WorktreeResult,
} from "../core/git";
import type { CurrentUser, PullRequestList, RepoPage } from "../core/github";
import type { View } from "../core/views";
import type { Project } from "../core/projects";
import type { NewEntry, ReviewEntry } from "../core/review";
import type { SetupCheck } from "../core/setup";
import type { Workspace } from "../core/workspaces";

// The Navigator's settings in its cog menu. layout: changed files as a tree or as a flat list.
export type NavigatorSettings = { layout: "tree" | "list" };
// The canvas bar's settings in its cog menu. showReviewed: reviewed file diffs stay in the Navigator and on the canvas.
export type ViewSettings = { diffStyle: "unified" | "split"; showReviewed: boolean };
// What the core changed on its own, e.g. when an agent turn ends, so the UI refetches it (ADR 0017).
export type Changed = {
  workspaceId: number;
  what: "entries" | "worktree" | "transcript" | "view";
};

// The one interface between the UI and the core (ADR 0002).
const api = {
  currentUser: (): Promise<CurrentUser> => ipcRenderer.invoke("github:current-user"),
  listRepos: (page: number): Promise<RepoPage> => ipcRenderer.invoke("github:list-repos", page),
  listProjects: (): Promise<Project[]> => ipcRenderer.invoke("projects:list"),
  openProject: (fullName: string): Promise<Project> =>
    ipcRenderer.invoke("projects:open", fullName),
  listPullRequests: (owner: string, name: string): Promise<PullRequestList> =>
    ipcRenderer.invoke("github:list-pulls", owner, name),
  cloneProject: (projectId: number): Promise<CloneResult> =>
    ipcRenderer.invoke("git:clone", projectId),
  openedBefore: (workspaceId: number): Promise<WorktreeResult | null> =>
    ipcRenderer.invoke("git:opened-before", workspaceId),
  openWorktree: (workspaceId: number): Promise<WorktreeResult> =>
    ipcRenderer.invoke("git:open-worktree", workspaceId),
  // The PR's commits since the merge base, newest first: the Commits pane's list.
  listCommits: (
    workspaceId: number,
    mergeBase: string,
  ): Promise<{ status: "ok"; commits: Commit[] } | GitProblem> =>
    ipcRenderer.invoke("git:commits", workspaceId, mergeBase),
  // With head: a commit diff, mergeBase being the commit's parent.
  listChangedFiles: (
    workspaceId: number,
    mergeBase: string,
    head?: string,
  ): Promise<ChangedFileList> =>
    ipcRenderer.invoke("git:changed-files", workspaceId, mergeBase, head),
  listWorktreeFiles: (workspaceId: number): Promise<FileTreeResult> =>
    ipcRenderer.invoke("git:worktree-files", workspaceId),
  readWorktreeFile: (workspaceId: number, path: string): Promise<FileText> =>
    ipcRenderer.invoke("git:read-worktree-file", workspaceId, path),
  readFileAt: (workspaceId: number, commit: string, path: string): Promise<FileText> =>
    ipcRenderer.invoke("git:read-file-at", workspaceId, commit, path),
  // Go to Definition: where a token clicked in a worktree file (from) is defined.
  findDefinitions: (workspaceId: number, from: string, token: string): Promise<CodeLineList> =>
    ipcRenderer.invoke("git:definitions", workspaceId, from, token),
  // Find Usages: the worktree's lines with the name as a whole word.
  findUsages: (workspaceId: number, token: string): Promise<CodeLineList> =>
    ipcRenderer.invoke("git:usages", workspaceId, token),
  // The startup check: which of git, gh (signed in) and claude are missing.
  checkSetup: (): Promise<SetupCheck> => ipcRenderer.invoke("setup:check"),
  listWorkspaces: (projectId: number): Promise<Workspace[]> =>
    ipcRenderer.invoke("workspaces:list", projectId),
  openPullRequestWorkspace: (projectId: number, prNumber: number): Promise<Workspace> =>
    ipcRenderer.invoke("workspaces:open-pr", projectId, prNumber),
  removeWorkspace: (workspaceId: number): Promise<void> =>
    ipcRenderer.invoke("workspaces:remove", workspaceId),
  listAgentSessions: (workspaceId: number): Promise<AgentSession[]> =>
    ipcRenderer.invoke("agents:list", workspaceId),
  // agent: the one picked for it; without it, the one picked last.
  startAgentSession: (workspaceId: number, agent?: Agent): Promise<AgentSession> =>
    ipcRenderer.invoke("agents:start", workspaceId, agent),
  newSessionAgent: (): Promise<Agent> => ipcRenderer.invoke("agents:new-session-agent"),
  // The composer's model and effort for an agent's sessions, with the choices; kept for every session of the agent.
  listAgentPicks: (workspaceId: number, agent: Agent): Promise<AgentPicks> =>
    ipcRenderer.invoke("agents:picks", workspaceId, agent),
  setAgentPick: (agent: Agent, pick: Pick, value: string): Promise<void> =>
    ipcRenderer.invoke("agents:set-pick", agent, pick, value),
  readTranscript: (agentSessionId: string): Promise<ChatEntry[]> =>
    ipcRenderer.invoke("agents:transcript", agentSessionId),
  runTurn: (agentSessionId: string, message: string): Promise<TurnResult> =>
    ipcRenderer.invoke("agents:run-turn", agentSessionId, message),
  // The workspace's entries, each current or outdated in the view of base → head (ADR 0015).
  listEntries: (workspaceId: number, base: string, head?: string): Promise<ReviewEntry[]> =>
    ipcRenderer.invoke("review:list", workspaceId, base, head),
  addNote: (note: NewEntry): Promise<ReviewEntry> => ipcRenderer.invoke("review:add-note", note),
  deleteEntry: (id: number): Promise<void> => ipcRenderer.invoke("review:delete", id),
  resolveThread: (id: number, resolved: boolean): Promise<void> =>
    ipcRenderer.invoke("review:resolve", id, resolved),
  editEntry: (id: number, body: string): Promise<void> =>
    ipcRenderer.invoke("review:edit", id, body),
  // A thread's *Send to agent*: its latest note becomes a question, answered in the thread. Null if it has none.
  sendThread: (workspaceId: number, threadId: number): Promise<ReviewEntry | null> =>
    ipcRenderer.invoke("review:send-thread", workspaceId, threadId),
  askQuestion: (question: NewEntry): Promise<ReviewEntry> =>
    ipcRenderer.invoke("review:ask", question),
  stopQuestion: (workspaceId: number): Promise<void> =>
    ipcRenderer.invoke("review:stop", workspaceId),
  // Every thread to the agent pane's session in one message; resolves when the agent's turn ends.
  sendReview: (workspaceId: number): Promise<TurnResult> =>
    ipcRenderer.invoke("review:send-all", workspaceId),
  onQuestionChat: (callback: (threadId: number, entry: ChatEntry) => void) => {
    const listener = (_: unknown, id: number, entry: ChatEntry) => callback(id, entry);
    ipcRenderer.on("review:chat", listener);
    return () => void ipcRenderer.off("review:chat", listener);
  },
  onQuestionPermission: (callback: (threadId: number, permission: Permission) => void) => {
    const listener = (_: unknown, id: number, p: Permission) => callback(id, p);
    ipcRenderer.on("review:permission", listener);
    return () => void ipcRenderer.off("review:permission", listener);
  },
  onQuestionEnd: (callback: (threadId: number, result: TurnResult) => void) => {
    const listener = (_: unknown, id: number, result: TurnResult) => callback(id, result);
    ipcRenderer.on("review:turn-end", listener);
    return () => void ipcRenderer.off("review:turn-end", listener);
  },
  // head: a pinned range (a view); without it, the worktree (ADR 0014).
  listReviewed: (workspaceId: number, mergeBase: string, head?: string): Promise<string[]> =>
    ipcRenderer.invoke("reviewed:list", workspaceId, mergeBase, head),
  setReviewed: (
    workspaceId: number,
    mergeBase: string,
    path: string,
    reviewed: boolean,
    head?: string,
  ): Promise<void> =>
    ipcRenderer.invoke("reviewed:set", workspaceId, mergeBase, path, reviewed, head),
  // The workspace's views, newest first (ADR 0023, 0026).
  listViews: (workspaceId: number): Promise<View[]> =>
    ipcRenderer.invoke("views:list", workspaceId),
  // The composer's Comment/Agent toggle, kept for every comment box.
  getCommentToAgent: (): Promise<boolean> => ipcRenderer.invoke("settings:comment-to-agent"),
  setCommentToAgent: (toAgent: boolean): Promise<void> =>
    ipcRenderer.invoke("settings:set-comment-to-agent", toAgent),
  stopTurn: (agentSessionId: string): Promise<void> =>
    ipcRenderer.invoke("agents:stop-turn", agentSessionId),
  onPermission: (callback: (agentSessionId: string, permission: Permission) => void) => {
    const listener = (_: unknown, id: string, p: Permission) => callback(id, p);
    ipcRenderer.on("agents:permission", listener);
    return () => void ipcRenderer.off("agents:permission", listener);
  },
  // The user's pick for a permission request, in L4 or a question's thread; null cancels it.
  answerPermission: (id: string, optionId: string | null): Promise<void> =>
    ipcRenderer.invoke("agents:answer-permission", id, optionId),
  onChatEntry: (callback: (agentSessionId: string, entry: ChatEntry) => void) => {
    const listener = (_: unknown, id: string, entry: ChatEntry) => callback(id, entry);
    ipcRenderer.on("agents:entry", listener);
    return () => void ipcRenderer.off("agents:entry", listener);
  },
  // Native menu (ADR 0004). Resolves with the new settings when an item is picked; stays pending if dismissed.
  showNavigatorMenu: (settings: NavigatorSettings): Promise<NavigatorSettings> =>
    ipcRenderer.invoke("menus:navigator", settings),
  showViewMenu: (settings: ViewSettings): Promise<ViewSettings> =>
    ipcRenderer.invoke("menus:view", settings),
  // A thread's ⋯ menu; stays pending if dismissed.
  showThreadMenu: (can: { edit: boolean; send: boolean }): Promise<"edit" | "delete" | "send"> =>
    ipcRenderer.invoke("menus:thread", can),
  // A pick from a list (the agent pane's session, agent, model, effort): the index of the picked label. Pending if
  // dismissed.
  showPickMenu: (labels: string[], checked: number): Promise<number> =>
    ipcRenderer.invoke("menus:pick", labels, checked),
  // A token's context menu in the canvas; stays pending if dismissed.
  showTokenMenu: (): Promise<"definition" | "usages"> => ipcRenderer.invoke("menus:token"),
  // Definitions or usages to pick from, how many didn't fit, and what to say when there are none: the index of the
  // picked label. Pending if dismissed.
  showCodeLinesMenu: (labels: string[], more: number, none: string): Promise<number> =>
    ipcRenderer.invoke("menus:code-lines", labels, more, none),
  // A workspace's context menu in L1; stays pending if dismissed.
  showWorkspaceMenu: (): Promise<"remove"> => ipcRenderer.invoke("menus:workspace"),
  // A native confirmation before a destructive action: `action` names its button. True if confirmed.
  confirm: (c: { message: string; detail: string; action: string }): Promise<boolean> =>
    ipcRenderer.invoke("dialogs:confirm", c),
  // L1's project menu: the project to switch to, or null for Add Project. Pending if dismissed.
  showProjectsMenu: (fullNames: string[]): Promise<string | null> =>
    ipcRenderer.invoke("menus:projects", fullNames),
  // The canvas's new view menu: the message for the agent pane's composer that asks for it. Pending if dismissed.
  showNewViewMenu: (): Promise<string> => ipcRenderer.invoke("menus:new-view"),
  onChanged: (callback: (change: Changed) => void) => {
    const listener = (_: unknown, change: Changed) => callback(change);
    ipcRenderer.on("changed", listener);
    return () => void ipcRenderer.off("changed", listener);
  },
  onToggleNavigator: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("toggle-navigator", listener);
    return () => void ipcRenderer.off("toggle-navigator", listener);
  },
  // Greys View > Back and Forward out at either end of the canvas's history.
  setNavigation: (canBack: boolean, canForward: boolean) =>
    ipcRenderer.send("navigation", canBack, canForward),
  // View > Back (-1) and Forward (1) through the canvas's history.
  onNavigate: (callback: (by: -1 | 1) => void) => {
    const listener = (_: unknown, by: -1 | 1) => callback(by);
    ipcRenderer.on("navigate", listener);
    return () => void ipcRenderer.off("navigate", listener);
  },
  onOpenQuickly: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("open-quickly", listener);
    return () => void ipcRenderer.off("open-quickly", listener);
  },
  // ADR 0026: draws the view tools' diagrams to check them; the callback gives each one's error, or null if it drew.
  onCheckDiagrams: (callback: (codes: string[]) => Promise<(string | null)[]>) => {
    const listener = async (_: unknown, id: number, codes: string[]) =>
      ipcRenderer.send("diagrams:checked", id, await callback(codes));
    ipcRenderer.on("diagrams:check", listener);
    return () => void ipcRenderer.off("diagrams:check", listener);
  },
  onOpenSettings: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("open-settings", listener);
    return () => void ipcRenderer.off("open-settings", listener);
  },
};

export type CoxswainApi = typeof api;

contextBridge.exposeInMainWorld("coxswain", api);
