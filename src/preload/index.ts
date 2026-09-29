import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { Attachment, AttachmentInput } from "../core/attachments";
import type { PromptCapabilities } from "@agentclientprotocol/sdk";
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
  BranchList,
  ChangedFileList,
  CloneResult,
  Commit,
  FileText,
  FileTreeResult,
  GitProblem,
  WorktreeResult,
} from "../core/git";
import type { CodeAt, CodeLineList } from "../core/lsp";
import type {
  CreatedPullRequest,
  CurrentUser,
  PullRequestList,
  PullRequestTitles,
  RepoPage,
} from "../core/github";
import type { AttachedPrompt, Prompt, View, ViewRange } from "../core/views";
import type { Project } from "../core/projects";
import type { NewEntry, ReviewEntry } from "../core/review";
import type { SetupCheck } from "../core/setup";
import type { Workspace } from "../core/workspaces";
import type { SessionState } from "../core/session-state";
import type { SummaryCoverage, SummaryJob, SummarySettings } from "../core/summaries";

// The Navigator's settings in its cog menu. layout: changed files as a tree or as a flat list.
// The canvas bar's settings in its cog menu. showReviewed: reviewed file diffs stay in the Navigator and on the canvas.
// The canvas's display options (its sliders button): how file diffs show, and how the Navigator lists them.
export type ViewSettings = {
  diffStyle: "unified" | "split";
  showReviewed: boolean;
  layout: "tree" | "list";
};
// What the Diff tab shows (glossary: scope), or "commits" to pick a commit or an agent turn in the Commits pane.
export type RangePick = "all" | "pushed" | "local" | "commits";
// What the core changed on its own, e.g. when an agent turn ends, so the UI refetches it (ADR 0017).
export type Changed = {
  workspaceId: number;
  what: "entries" | "worktree" | "transcript" | "sessions" | "view";
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
  // The rail's titles: title and state of the workspaces' PRs, open or not.
  listPullRequestTitles: (
    owner: string,
    name: string,
    numbers: number[],
  ): Promise<PullRequestTitles> => ipcRenderer.invoke("github:pull-titles", owner, name, numbers),
  cloneProject: (projectId: number): Promise<CloneResult> =>
    ipcRenderer.invoke("git:clone", projectId),
  openedBefore: (workspaceId: number): Promise<WorktreeResult | null> =>
    ipcRenderer.invoke("git:opened-before", workspaceId),
  openWorktree: (workspaceId: number): Promise<WorktreeResult> =>
    ipcRenderer.invoke("git:open-worktree", workspaceId),
  // The branches to start a branch workspace from, and the default one.
  listBranches: (projectId: number): Promise<BranchList> =>
    ipcRenderer.invoke("git:branches", projectId),
  // The worktree as a commit, uncommitted changes included (ADR 0028): what a new view is pinned to.
  snapshot: (workspaceId: number): Promise<{ status: "ok"; sha: string } | GitProblem> =>
    ipcRenderer.invoke("git:snapshot", workspaceId),
  // Pushes the worktree's branch; never forced.
  push: (workspaceId: number): Promise<{ status: "ok" } | GitProblem> =>
    ipcRenderer.invoke("git:push", workspaceId),
  // A branch workspace's draft PR: pushes, opens it, and shows it in the browser.
  openPullRequest: (workspaceId: number): Promise<CreatedPullRequest | GitProblem> =>
    ipcRenderer.invoke("git:open-pull-request", workspaceId),
  // The commits since the merge base (or since another commit, e.g. what's pushed), newest first: the Commits pane's.
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
  // Go to Definition and Find Usages (ADR 0034): where a name clicked is defined or used, at the same revision.
  findDefinitions: (workspaceId: number, at: CodeAt): Promise<CodeLineList> =>
    ipcRenderer.invoke("lsp:definitions", workspaceId, at),
  findUsages: (workspaceId: number, at: CodeAt): Promise<CodeLineList> =>
    ipcRenderer.invoke("lsp:usages", workspaceId, at),
  // The startup check: which of git, gh (signed in) and claude are missing.
  checkSetup: (): Promise<SetupCheck> => ipcRenderer.invoke("setup:check"),
  listWorkspaces: (projectId: number): Promise<Workspace[]> =>
    ipcRenderer.invoke("workspaces:list", projectId),
  openWorkspace: (workspaceId: number): Promise<void> =>
    ipcRenderer.invoke("workspaces:open", workspaceId),
  openPullRequestWorkspace: (
    projectId: number,
    prNumber: number,
    headRef: string,
  ): Promise<Workspace> => ipcRenderer.invoke("workspaces:open-pr", projectId, prNumber, headRef),
  // Rejects with a message if the branch name isn't one git takes.
  openBranchWorkspace: (
    projectId: number,
    branch: string,
    baseBranch: string,
  ): Promise<Workspace> =>
    ipcRenderer.invoke("workspaces:open-branch", projectId, branch, baseBranch),
  removeWorkspace: (workspaceId: number): Promise<void> =>
    ipcRenderer.invoke("workspaces:remove", workspaceId),
  // The agent turns that changed the worktree, newest first, as commits between their snapshots (ADR 0028).
  listTurns: (workspaceId: number): Promise<Commit[]> =>
    ipcRenderer.invoke("agents:turns", workspaceId),
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
  readAgentState: (agentSessionId: string): Promise<SessionState> =>
    ipcRenderer.invoke("agents:state", agentSessionId),
  onAgentState: (callback: (id: string, state: SessionState) => void) => {
    const listener = (_: unknown, id: string, state: SessionState) => callback(id, state);
    ipcRenderer.on("agents:state", listener);
    return () => void ipcRenderer.off("agents:state", listener);
  },
  attachmentImage: (bundleId: string, attachmentId: string): Promise<string | null> =>
    ipcRenderer.invoke("attachments:image", bundleId, attachmentId),
  pickAttachments: (): Promise<Attachment[]> => ipcRenderer.invoke("attachments:pick"),
  prepareAttachments: async (files: File[]): Promise<Attachment[]> => {
    if (files.length > 10) throw new Error("Attach up to 10 files per message.");
    if (files.reduce((sum, file) => sum + file.size, 0) > 20 * 1024 * 1024)
      throw new Error("Attachments must total 20 MB or less.");
    const inputs: AttachmentInput[] = [];
    for (const file of files) {
      if (file.size > 20 * 1024 * 1024)
        throw new Error(`${file.name}: files must be 20 MB or less.`);
      const path = webUtils.getPathForFile(file);
      inputs.push(
        path ? { path } : { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
      );
    }
    return ipcRenderer.invoke("attachments:prepare", inputs);
  },
  agentAttachmentCapabilities: (agent: Agent): Promise<PromptCapabilities> =>
    ipcRenderer.invoke("agents:attachment-capabilities", agent),
  // view: a New View prompt attached to the message.
  runTurn: (
    agentSessionId: string,
    message: string,
    view?: AttachedPrompt,
    attachments?: Attachment[],
  ): Promise<TurnResult> =>
    ipcRenderer.invoke("agents:run-turn", agentSessionId, message, view, attachments),
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
  // The same message, put on the clipboard instead; false if there are no threads.
  copyReviewPrompt: (workspaceId: number): Promise<boolean> =>
    ipcRenderer.invoke("review:copy-prompt", workspaceId),
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
  listReviewed: (
    workspaceId: number,
    mergeBase: string,
    head?: string,
    kind?: "diff" | "file",
  ): Promise<string[]> => ipcRenderer.invoke("reviewed:list", workspaceId, mergeBase, head, kind),
  setReviewed: (
    workspaceId: number,
    mergeBase: string,
    path: string,
    reviewed: boolean,
    head?: string,
    kind?: "diff" | "file",
  ): Promise<void> =>
    ipcRenderer.invoke("reviewed:set", workspaceId, mergeBase, path, reviewed, head, kind),
  // The workspace's views, newest first (ADR 0023, 0026).
  listViews: (workspaceId: number): Promise<View[]> =>
    ipcRenderer.invoke("views:list", workspaceId),
  // Removes a view with its explanations and findings.
  removeView: (viewId: number): Promise<void> => ipcRenderer.invoke("views:remove", viewId),
  // ADR 0030: watches the workspace on screen for its HEAD moving; null stops.
  watchWorkspace: (workspaceId: number | null): Promise<void> =>
    ipcRenderer.invoke("workspaces:watch", workspaceId),
  // How many of the workspace's committed file diffs have a file summary.
  summaryCoverage: (workspaceId: number): Promise<SummaryCoverage | null> =>
    ipcRenderer.invoke("summaries:coverage", workspaceId),
  // ADR 0029: the file summary jobs Activity shows, newest first, and how they change.
  listSummaryJobs: (): Promise<SummaryJob[]> => ipcRenderer.invoke("summaries:jobs"),
  onSummaryJobs: (callback: (jobs: SummaryJob[]) => void) => {
    const listener = (_: unknown, jobs: SummaryJob[]) => callback(jobs);
    ipcRenderer.on("summaries:jobs", listener);
    return () => void ipcRenderer.off("summaries:jobs", listener);
  },
  stopSummaryJob: (id: number): Promise<void> => ipcRenderer.invoke("summaries:stop", id),
  getSummarySettings: (): Promise<SummarySettings> => ipcRenderer.invoke("summaries:settings"),
  setSummarySettings: (s: Partial<SummarySettings>): Promise<void> =>
    ipcRenderer.invoke("summaries:set-settings", s),
  // The composer's Comment/Agent toggle, kept for every comment box.
  getCommentToAgent: (): Promise<boolean> => ipcRenderer.invoke("settings:comment-to-agent"),
  setCommentToAgent: (toAgent: boolean): Promise<void> =>
    ipcRenderer.invoke("settings:set-comment-to-agent", toAgent),
  stopTurn: (agentSessionId: string): Promise<void> =>
    ipcRenderer.invoke("agents:stop-turn", agentSessionId),
  // A message queued behind the running turn: sent into it now, or taken off the queue.
  steerQueued: (agentSessionId: string, queuedId: number): Promise<void> =>
    ipcRenderer.invoke("agents:steer", agentSessionId, queuedId),
  unqueue: (agentSessionId: string, queuedId: number): Promise<void> =>
    ipcRenderer.invoke("agents:unqueue", agentSessionId, queuedId),
  // Stops a command the agent left running in the background.
  stopBackgroundTask: (agentSessionId: string, taskId: string): Promise<void> =>
    ipcRenderer.invoke("agents:stop-task", agentSessionId, taskId),
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
  showViewMenu: (settings: ViewSettings): Promise<ViewSettings> =>
    ipcRenderer.invoke("menus:view", settings),
  // The bottom bar's Hand off menu: send the open threads to the agent, or copy them as a prompt. Pending if dismissed.
  showHandOffMenu: (): Promise<"agent" | "copy"> => ipcRenderer.invoke("menus:hand-off"),
  // The Diff tab's range menu: a scope, or "commits". `scope` is null while a commit or turn shows. Pending if dismissed.
  showRangeMenu: (scope: "all" | "pushed" | "local" | null, hasPr: boolean): Promise<RangePick> =>
    ipcRenderer.invoke("menus:range", scope, hasPr),
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
  // A view chip's context menu; pending if dismissed.
  showViewChipMenu: (): Promise<"remove"> => ipcRenderer.invoke("menus:view-chip"),
  // A native confirmation before a destructive action: `action` names its button. True if confirmed.
  confirm: (c: { message: string; detail: string; action: string }): Promise<boolean> =>
    ipcRenderer.invoke("dialogs:confirm", c),
  // L1's project menu: the project to switch to, or null for Add Project. Pending if dismissed.
  showProjectsMenu: (fullNames: string[]): Promise<string | null> =>
    ipcRenderer.invoke("menus:projects", fullNames),
  // The canvas's new view menu: the prompt to attach to the agent pane's composer, or "new-prompt" for New Prompt… (Settings).
  // Pending if dismissed. range: what the canvas shows, when it isn't all of the workspace's changes.
  showNewViewMenu: (range: ViewRange | null): Promise<AttachedPrompt | "new-prompt"> =>
    ipcRenderer.invoke("menus:new-view", range),
  // The New View prompts: the built-in ones (id null), then the user's own.
  listPrompts: (): Promise<Prompt[]> => ipcRenderer.invoke("prompts:list"),
  savePrompt: (title: string, body: string): Promise<void> =>
    ipcRenderer.invoke("prompts:save", title, body),
  deletePrompt: (id: number): Promise<void> => ipcRenderer.invoke("prompts:delete", id),
  // A prompt as the composer attaches it, for the command palette's New View actions; null for New View….
  attachPrompt: (p: Prompt | null, range: ViewRange | null): Promise<AttachedPrompt> =>
    ipcRenderer.invoke("prompts:attach", p, range),
  onChanged: (callback: (change: Changed) => void) => {
    const listener = (_: unknown, change: Changed) => callback(change);
    ipcRenderer.on("changed", listener);
    return () => void ipcRenderer.off("changed", listener);
  },
  // Greys View > Back and Forward out at either end of the canvas's history.
  setNavigation: (canBack: boolean, canForward: boolean) =>
    ipcRenderer.send("navigation", canBack, canForward),
  // A native menu item or key picked: the id of the action to run (ADR 0027).
  onAction: (callback: (id: string) => void) => {
    const listener = (_: unknown, id: string) => callback(id);
    ipcRenderer.on("action", listener);
    return () => void ipcRenderer.off("action", listener);
  },
  // ADR 0026: draws the view tools' diagrams to check them; the callback gives each one's error, or null if it drew.
  onCheckDiagrams: (callback: (codes: string[]) => Promise<(string | null)[]>) => {
    const listener = async (_: unknown, id: number, codes: string[]) =>
      ipcRenderer.send("diagrams:checked", id, await callback(codes));
    ipcRenderer.on("diagrams:check", listener);
    return () => void ipcRenderer.off("diagrams:check", listener);
  },
};

export type CoxswainApi = typeof api;

contextBridge.exposeInMainWorld("coxswain", api);
