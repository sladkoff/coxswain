import { contextBridge, ipcRenderer } from 'electron'
import type { AgentSession, ChatEntry, TurnResult } from '../core/agents'
import type {
  ChangedFileList,
  CurrentUser,
  FileText,
  FileTreeResult,
  PullRequestCommits,
  PullRequestList,
  RepoPage,
} from '../core/github'
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
  listChangedFiles: (owner: string, name: string, prNumber: number): Promise<ChangedFileList> =>
    ipcRenderer.invoke('github:changed-files', owner, name, prNumber),
  getPullRequestCommits: (owner: string, name: string, prNumber: number): Promise<PullRequestCommits> =>
    ipcRenderer.invoke('github:pr-commits', owner, name, prNumber),
  listFilesAt: (owner: string, name: string, commit: string): Promise<FileTreeResult> =>
    ipcRenderer.invoke('github:files-at', owner, name, commit),
  readFileAt: (owner: string, name: string, commit: string, path: string): Promise<FileText> =>
    ipcRenderer.invoke('github:read-file', owner, name, commit, path),
  listWorkspaces: (projectId: number): Promise<Workspace[]> => ipcRenderer.invoke('workspaces:list', projectId),
  openPullRequestWorkspace: (projectId: number, prNumber: number): Promise<Workspace> =>
    ipcRenderer.invoke('workspaces:open-pr', projectId, prNumber),
  listAgentSessions: (workspaceId: number): Promise<AgentSession[]> => ipcRenderer.invoke('agents:list', workspaceId),
  startAgentSession: (workspaceId: number): Promise<AgentSession> => ipcRenderer.invoke('agents:start', workspaceId),
  readTranscript: (agentSessionId: string): Promise<ChatEntry[]> => ipcRenderer.invoke('agents:transcript', agentSessionId),
  runTurn: (agentSessionId: string, message: string): Promise<TurnResult> =>
    ipcRenderer.invoke('agents:run-turn', agentSessionId, message),
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
