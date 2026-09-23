import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import { join } from 'node:path'
import { openDatabase } from '../core/db'
import {
  getCurrentUser,
  getPullRequestCommits,
  listChangedFiles,
  listFilesAt,
  listPullRequests,
  listRepos,
  readFileAt,
} from '../core/github'
import { listProjects, openProject } from '../core/projects'
import { listWorkspaces, openPullRequestWorkspace } from '../core/workspaces'

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    titleBarStyle: 'hiddenInset',
    webPreferences: { preload: join(__dirname, '../preload/index.js') },
  })
  win.once('ready-to-show', () => win.show())

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
  ipcMain.handle('github:changed-files', (_, owner: string, name: string, prNumber: number) =>
    listChangedFiles(owner, name, prNumber),
  )
  ipcMain.handle('github:pr-commits', (_, owner: string, name: string, prNumber: number) =>
    getPullRequestCommits(owner, name, prNumber),
  )
  ipcMain.handle('github:files-at', (_, owner: string, name: string, commit: string) =>
    listFilesAt(owner, name, commit),
  )
  ipcMain.handle('github:read-file', (_, owner: string, name: string, commit: string, path: string) =>
    readFileAt(owner, name, commit, path),
  )
  ipcMain.handle('workspaces:list', (_, projectId: number) => listWorkspaces(db, projectId))
  ipcMain.handle('workspaces:open-pr', (_, projectId: number, prNumber: number) =>
    openPullRequestWorkspace(db, projectId, prNumber),
  )
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
