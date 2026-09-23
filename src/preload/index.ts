import { contextBridge, ipcRenderer } from 'electron'
import type { AgentSession, ChatEntry, TurnResult } from '../core/agents'
import type { Comment, NewComment } from '../core/comments'
import type { ChangedFileList, CloneResult, FileText, FileTreeResult, WorktreeResult } from '../core/git'
import type { CurrentUser, PullRequestList, RepoPage } from '../core/github'
import type { Project } from '../core/projects'
import type { Workspace } from '../core/workspaces'

// The one interface between the UI and the core (ADR 0002).
const api = {
  currentUser: (): Promise<CurrentUser> => ipcRenderer.invoke('github:current-user'),
  listRepos: (page: number): Promise<RepoPage> => ipcRenderer.invoke('github:list-repos', page),
  listProjects: (): Promise<Project[]> => ipcRenderer.invoke('projects:list'),
  openProject: (fullName: string): Promise<Project> => ipcRenderer.invoke('projects:open', fullName),
  listPullRequests: (owner: string, name: string): Promise<PullRequestList> =>
    ipcRenderer.invoke('github:list-pulls', owner, name),
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
  readTranscript: (agentSessionId: string): Promise<ChatEntry[]> => ipcRenderer.invoke('agents:transcript', agentSessionId),
  runTurn: (agentSessionId: string, message: string, commentIds: number[]): Promise<TurnResult> =>
    ipcRenderer.invoke('agents:run-turn', agentSessionId, message, commentIds),
  listComments: (workspaceId: number): Promise<Comment[]> => ipcRenderer.invoke('comments:list', workspaceId),
  addComment: (comment: NewComment): Promise<Comment> => ipcRenderer.invoke('comments:add', comment),
  deleteComment: (id: number): Promise<void> => ipcRenderer.invoke('comments:delete', id),
  stopTurn: (agentSessionId: string): Promise<void> => ipcRenderer.invoke('agents:stop-turn', agentSessionId),
  onChatEntry: (callback: (agentSessionId: string, entry: ChatEntry) => void) => {
    const listener = (_: unknown, id: string, entry: ChatEntry) => callback(id, entry)
    ipcRenderer.on('agents:entry', listener)
    return () => void ipcRenderer.off('agents:entry', listener)
  },
  onOpenSettings: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('open-settings', listener)
    return () => void ipcRenderer.off('open-settings', listener)
  },
}

export type CoxswainApi = typeof api

contextBridge.exposeInMainWorld('coxswain', api)
