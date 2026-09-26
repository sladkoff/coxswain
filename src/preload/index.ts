import { contextBridge, ipcRenderer } from "electron";
import type { AgentSession, ChatEntry, Permission, TurnResult } from "../core/agents";
import type {
  ChangedFileList,
  CloneResult,
  Commit,
  FileText,
  FileTreeResult,
  GitProblem,
  WorktreeResult,
} from "../core/git";
import type { CurrentUser, PullRequestList, RepoPage } from "../core/github";
import type { Guide } from "../core/guides";
import type { Project } from "../core/projects";
import type { NewEntry, ReviewEntry } from "../core/review";
import type { Workspace } from "../core/workspaces";

// The Navigator's settings in its cog menu. layout: changed files as a tree or as a flat list.
export type NavigatorSettings = { layout: "tree" | "list" };
// The canvas bar's settings in its cog menu. showReviewed: reviewed file diffs stay in the Navigator and on the canvas.
export type ViewSettings = { diffStyle: "unified" | "split"; showReviewed: boolean };
// What the core changed on its own, e.g. when an agent turn ends, so the UI refetches it (ADR 0017).
export type Changed = {
  workspaceId: number;
  what: "entries" | "worktree" | "transcript" | "guide";
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
  listWorkspaces: (projectId: number): Promise<Workspace[]> =>
    ipcRenderer.invoke("workspaces:list", projectId),
  openPullRequestWorkspace: (projectId: number, prNumber: number): Promise<Workspace> =>
    ipcRenderer.invoke("workspaces:open-pr", projectId, prNumber),
  listAgentSessions: (workspaceId: number): Promise<AgentSession[]> =>
    ipcRenderer.invoke("agents:list", workspaceId),
  startAgentSession: (workspaceId: number): Promise<AgentSession> =>
    ipcRenderer.invoke("agents:start", workspaceId),
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
  // head: a pinned range (a guide); without it, the worktree (ADR 0014).
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
  // The workspace's guides, newest first (ADR 0023).
  listGuides: (workspaceId: number): Promise<Guide[]> =>
    ipcRenderer.invoke("guides:list", workspaceId),
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
  // The canvas's Guide menu: make one (make: with review), or the guide to show (null: none). Pending if dismissed.
  showGuideMenu: (
    workspaceId: number,
    shown: number | null,
    prHead: string,
  ): Promise<{ prompt: string } | { show: number | null }> =>
    ipcRenderer.invoke("menus:guide", workspaceId, shown, prHead),
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
  onOpenSettings: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("open-settings", listener);
    return () => void ipcRenderer.off("open-settings", listener);
  },
};

export type CoxswainApi = typeof api;

contextBridge.exposeInMainWorld("coxswain", api);
