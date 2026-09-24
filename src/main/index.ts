import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import { join } from 'node:path'
import { listAgentSessions, readTranscript, runTurn, startAgentSession, stopAllTurns, stopTurn } from '../core/agents'
import { addComment, deleteComment, listComments, type NewComment } from '../core/comments'
import { openDatabase } from '../core/db'
import {
  cloneProject,
  listChangedFiles,
  listWorktreeFiles,
  openedBefore,
  openWorktree,
  readFileAt,
  readWorktreeFile,
} from '../core/git'
import { getCurrentUser, listPullRequests, listRepos } from '../core/github'
import { listProjects, openProject } from '../core/projects'
import { listWorkspaces, openPullRequestWorkspace } from '../core/workspaces'

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800, // both side panes at their minimum (240px) and the Viewer at its own (320px)
    minHeight: 500,
    show: false,
    titleBarStyle: 'hiddenInset',
    webPreferences: { preload: join(__dirname, '../preload/index.js') },
  })
  win.once('ready-to-show', () => win.show())
  // Links in agent replies open in the browser, never in the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function openSettings() {
  BrowserWindow.getFocusedWindow()?.webContents.send('open-settings')
}

// ponytail: macOS menu layout only; add a File > Settings entry when we ship Windows/Linux.
const menu = Menu.buildFromTemplate([
  {
    label: app.name,
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: openSettings },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  },
  { role: 'fileMenu' },
  { role: 'editMenu' },
  { role: 'viewMenu' },
  { role: 'windowMenu' },
])

app.whenReady().then(() => {
  Menu.setApplicationMenu(menu)
  const db = openDatabase(join(app.getPath('userData'), 'coxswain.db'))
  ipcMain.handle('projects:list', () => listProjects(db))
  ipcMain.handle('projects:open', (_, fullName: string) => openProject(db, fullName))
  ipcMain.handle('github:current-user', () => getCurrentUser())
  ipcMain.handle('github:list-repos', (_, page: number) => listRepos(page))
  ipcMain.handle('github:list-pulls', (_, owner: string, name: string) => listPullRequests(owner, name))
  ipcMain.handle('workspaces:list', (_, projectId: number) => listWorkspaces(db, projectId))
  ipcMain.handle('workspaces:open-pr', (_, projectId: number, prNumber: number) =>
    openPullRequestWorkspace(db, projectId, prNumber),
  )
  ipcMain.handle('git:clone', (_, projectId: number) => cloneProject(db, projectId))
  ipcMain.handle('git:opened-before', (_, workspaceId: number) => openedBefore(db, workspaceId))
  ipcMain.handle('git:open-worktree', (_, workspaceId: number) => openWorktree(db, workspaceId))
  ipcMain.handle('git:changed-files', (_, workspaceId: number, mergeBase: string) =>
    listChangedFiles(db, workspaceId, mergeBase),
  )
  ipcMain.handle('git:worktree-files', (_, workspaceId: number) => listWorktreeFiles(db, workspaceId))
  ipcMain.handle('git:read-worktree-file', (_, workspaceId: number, path: string) =>
    readWorktreeFile(db, workspaceId, path),
  )
  ipcMain.handle('git:read-file-at', (_, workspaceId: number, commit: string, path: string) =>
    readFileAt(db, workspaceId, commit, path),
  )
  ipcMain.handle('agents:list', (_, workspaceId: number) => listAgentSessions(db, workspaceId))
  ipcMain.handle('agents:start', (_, workspaceId: number) => startAgentSession(db, workspaceId))
  ipcMain.handle('agents:transcript', (_, agentSessionId: string) => readTranscript(agentSessionId))
  ipcMain.handle('comments:list', (_, workspaceId: number) => listComments(db, workspaceId))
  ipcMain.handle('comments:add', (_, comment: NewComment) => addComment(db, comment))
  ipcMain.handle('comments:delete', (_, id: number) => deleteComment(db, id))
  ipcMain.handle('agents:run-turn', (e, agentSessionId: string, message: string, commentIds: number[]) =>
    runTurn(db, agentSessionId, message, commentIds, (entry) => {
      if (!e.sender.isDestroyed()) e.sender.send('agents:entry', agentSessionId, entry)
    }),
  )
  ipcMain.handle('agents:stop-turn', (_, agentSessionId: string) => stopTurn(agentSessionId))
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', stopAllTurns)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
