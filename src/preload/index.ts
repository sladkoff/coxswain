import { contextBridge, ipcRenderer } from 'electron'
import type { AgentSession, ChatEntry, TurnResult } from '../core/agents'
import type { Comment, NewComment } from '../core/comments'
import type { ChangedFileList, CloneResult, FileText, FileTreeResult, WorktreeResult } from '../core/git'
import type { CurrentUser, PullRequestList, PullRequestOverview, RepoPage } from '../core/github'
import type { Guide, GuideProgress, GuideResult, GuideSettings, GuideSettingsChange } from '../core/guides'
import type { Project } from '../core/projects'
import type { Workspace } from '../core/workspaces'

// The Navigator's settings in its cog menu. layout: changed files as a tree or as a flat list.
export type NavigatorSettings = { layout: 'tree' | 'list' }
// The tab bar's settings in its cog menu, for the Diff and Guide tabs. showViewed: viewed file diffs stay in the
// Navigator and the Guide.
export type ViewSettings = { diffStyle: 'unified' | 'split'; showViewed: boolean }

// The one interface between the UI and the core (ADR 0002).
const api = {
  currentUser: (): Promise<CurrentUser> => ipcRenderer.invoke('github:current-user'),
  listRepos: (page: number): Promise<RepoPage> => ipcRenderer.invoke('github:list-repos', page),
  listProjects: (): Promise<Project[]> => ipcRenderer.invoke('projects:list'),
  openProject: (fullName: string): Promise<Project> => ipcRenderer.invoke('projects:open', fullName),
  listPullRequests: (owner: string, name: string): Promise<PullRequestList> =>
    ipcRenderer.invoke('github:list-pulls', owner, name),
  getPullRequestOverview: (workspaceId: number): Promise<PullRequestOverview> =>
    ipcRenderer.invoke('github:pull-overview', workspaceId),
  cloneProject: (projectId: number): Promise<CloneResult> => ipcRenderer.invoke('git:clone', projectId),
  openedBefore: (workspaceId: number): Promise<WorktreeResult | null> =>
    ipcRenderer.invoke('git:opened-before', workspaceId),
  openWorktree: (workspaceId: number): Promise<WorktreeResult> => ipcRenderer.invoke('git:open-worktree', workspaceId),
  listChangedFiles: (workspaceId: number, mergeBase: string): Promise<ChangedFileList> =>
    ipcRenderer.invoke('git:changed-files', workspaceId, mergeBase),
  listWorktreeFiles: (workspaceId: number): Promise<FileTreeResult> => ipcRenderer.invoke('git:worktree-files', workspaceId),
  readWorktreeFile: (workspaceId: number, path: string): Promise<FileText> =>
    ipcRenderer.invoke('git:read-worktree-file', workspaceId, path),
  readFileAt: (workspaceId: number, commit: string, path: string): Promise<FileText> =>
    ipcRenderer.invoke('git:read-file-at', workspaceId, commit, path),
  listWorkspaces: (projectId: number): Promise<Workspace[]> => ipcRenderer.invoke('workspaces:list', projectId),
  openPullRequestWorkspace: (projectId: number, prNumber: number): Promise<Workspace> =>
    ipcRenderer.invoke('workspaces:open-pr', projectId, prNumber),
  listAgentSessions: (workspaceId: number): Promise<AgentSession[]> => ipcRenderer.invoke('agents:list', workspaceId),
  startAgentSession: (workspaceId: number): Promise<AgentSession> => ipcRenderer.invoke('agents:start', workspaceId),
  startCommentSession: (commentId: number): Promise<AgentSession> => ipcRenderer.invoke('agents:start-for-comment', commentId),
  readTranscript: (agentSessionId: string): Promise<ChatEntry[]> => ipcRenderer.invoke('agents:transcript', agentSessionId),
  runTurn: (agentSessionId: string, message: string, commentIds: number[]): Promise<TurnResult> =>
    ipcRenderer.invoke('agents:run-turn', agentSessionId, message, commentIds),
  listComments: (workspaceId: number): Promise<Comment[]> => ipcRenderer.invoke('comments:list', workspaceId),
  addComment: (comment: NewComment): Promise<Comment> => ipcRenderer.invoke('comments:add', comment),
  deleteComment: (id: number): Promise<void> => ipcRenderer.invoke('comments:delete', id),
  listViewed: (workspaceId: number, mergeBase: string): Promise<string[]> =>
    ipcRenderer.invoke('viewed:list', workspaceId, mergeBase),
  setViewed: (workspaceId: number, mergeBase: string, path: string, viewed: boolean): Promise<void> =>
    ipcRenderer.invoke('viewed:set', workspaceId, mergeBase, path, viewed),
  getGuide: (workspaceId: number, mergeBase: string): Promise<Guide | null> =>
    ipcRenderer.invoke('guides:get', workspaceId, mergeBase),
  createGuide: (workspaceId: number, mergeBase: string): Promise<GuideResult> =>
    ipcRenderer.invoke('guides:create', workspaceId, mergeBase),
  onGuideProgress: (callback: (workspaceId: number, progress: GuideProgress) => void) => {
    const listener = (_: unknown, id: number, p: GuideProgress) => callback(id, p)
    ipcRenderer.on('guides:progress', listener)
    return () => void ipcRenderer.off('guides:progress', listener)
  },
  getGuideSettings: (): Promise<GuideSettings> => ipcRenderer.invoke('guides:settings'),
  setGuideSettings: (settings: GuideSettingsChange): Promise<void> =>
    ipcRenderer.invoke('guides:set-settings', settings),
  stopTurn: (agentSessionId: string): Promise<void> => ipcRenderer.invoke('agents:stop-turn', agentSessionId),
  onChatEntry: (callback: (agentSessionId: string, entry: ChatEntry) => void) => {
    const listener = (_: unknown, id: string, entry: ChatEntry) => callback(id, entry)
    ipcRenderer.on('agents:entry', listener)
    return () => void ipcRenderer.off('agents:entry', listener)
  },
  // Native menu (ADR 0004). Resolves with the new settings when an item is picked; stays pending if dismissed.
  showNavigatorMenu: (settings: NavigatorSettings): Promise<NavigatorSettings> =>
    ipcRenderer.invoke('menus:navigator', settings),
  showViewMenu: (settings: ViewSettings): Promise<ViewSettings> => ipcRenderer.invoke('menus:view', settings),
  onToggleNavigator: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('toggle-navigator', listener)
    return () => void ipcRenderer.off('toggle-navigator', listener)
  },
  onToggleAgents: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('toggle-agents', listener)
    return () => void ipcRenderer.off('toggle-agents', listener)
  },
  onOpenSettings: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('open-settings', listener)
    return () => void ipcRenderer.off('open-settings', listener)
  },
}

export type CoxswainApi = typeof api

contextBridge.exposeInMainWorld('coxswain', api)
