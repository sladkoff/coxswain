import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import { join } from 'node:path'
import icon from '../../resources/icon.png?asset'
import {
  listAgentSessions,
  readTranscript,
  runTurn,
  startAgentSession,
  stopAllTurns,
  stopTurn,
} from '../core/agents'
import { openDatabase } from '../core/db'
import {
  cloneProject,
  type Commit,
  listChangedFiles,
  listCommits,
  listWorktreeFiles,
  openedBefore,
  openWorktree,
  readFileAt,
  readWorktreeFile,
} from '../core/git'
import { createGuide, getGuide, getGuideSettings, type GuideSettingsChange, setGuideSettings, stopGuides } from '../core/guides'
import { getCurrentUser, getPullRequestOverview, listPullRequests, listRepos } from '../core/github'
import { listProjects, openProject } from '../core/projects'
import {
  addNote,
  askQuestion,
  deleteActionItem,
  deleteEntry,
  formatAsk,
  getRound,
  listEntries,
  type NewEntry,
  stopQuestion,
  updateActionItem,
  wrapUp,
} from '../core/review'
import { listViewed, setViewed } from '../core/viewed'
import type { NavigatorSettings, ViewSettings } from '../preload'
import { getWorkspaceRepo, listWorkspaces, openPullRequestWorkspace } from '../core/workspaces'

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800, // both side panes at their minimum (240px) and the Viewer at its own (320px)
    minHeight: 500,
    show: false,
    titleBarStyle: 'hiddenInset',
    icon, // Windows and Linux; macOS takes the Dock icon below
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
// ponytail: one window for now, so no focused window (e.g. the app isn't frontmost) means that one.
const sendToWindow = (channel: string) =>
  (BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0])?.webContents.send(channel)

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
  {
    label: 'View',
    submenu: [
      { label: 'Toggle Navigator', accelerator: 'CmdOrCtrl+B', click: () => sendToWindow('toggle-navigator') },
      { label: 'Toggle Agents', accelerator: 'CmdOrCtrl+Alt+B', click: () => sendToWindow('toggle-agents') },
      { type: 'separator' },
      { role: 'reload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  },
  { role: 'windowMenu' },
])

app.whenReady().then(() => {
  // ponytail: set at runtime since there's no packaging yet; build an .icns into the bundle when we package.
  app.dock?.setIcon(icon)
  Menu.setApplicationMenu(menu)
  const db = openDatabase(join(app.getPath('userData'), 'coxswain.db'))
  ipcMain.handle('projects:list', () => listProjects(db))
  ipcMain.handle('projects:open', (_, fullName: string) => openProject(db, fullName))
  ipcMain.handle('github:current-user', () => getCurrentUser())
  ipcMain.handle('github:list-repos', (_, page: number) => listRepos(page))
  ipcMain.handle('github:list-pulls', (_, owner: string, name: string) => listPullRequests(owner, name))
  ipcMain.handle('github:pull-overview', async (_, workspaceId: number) => {
    const { owner, name, prNumber } = await getWorkspaceRepo(db, workspaceId)
    return getPullRequestOverview(owner, name, prNumber)
  })
  ipcMain.handle('workspaces:list', (_, projectId: number) => listWorkspaces(db, projectId))
  ipcMain.handle('workspaces:open-pr', (_, projectId: number, prNumber: number) =>
    openPullRequestWorkspace(db, projectId, prNumber),
  )
  ipcMain.handle('git:clone', (_, projectId: number) => cloneProject(db, projectId))
  ipcMain.handle('git:opened-before', (_, workspaceId: number) => openedBefore(db, workspaceId))
  ipcMain.handle('git:open-worktree', (_, workspaceId: number) => openWorktree(db, workspaceId))
  ipcMain.handle('git:changed-files', (_, workspaceId: number, mergeBase: string, head?: string) =>
    listChangedFiles(db, workspaceId, mergeBase, head),
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
  ipcMain.handle('review:list', (_, workspaceId: number, base: string, head?: string) => listEntries(db, workspaceId, base, head))
  ipcMain.handle('review:add-note', (_, note: NewEntry) => addNote(db, note))
  ipcMain.handle('review:delete', (_, id: number) => deleteEntry(db, id))
  // Returns the question once saved; the reply streams as review:chat and the turn's end comes as review:turn-end.
  ipcMain.handle('review:ask', async (e, question: NewEntry) => {
    const send = (channel: string, ...args: unknown[]) => !e.sender.isDestroyed() && e.sender.send(channel, ...args)
    const asked = await askQuestion(db, question, (threadId, entry) => send('review:chat', threadId, entry))
    const threadId = asked.question.parentId ?? asked.question.id
    asked.turn.then((result) => send('review:turn-end', threadId, result))
    return asked.question
  })
  ipcMain.handle('review:stop', (_, workspaceId: number) => stopQuestion(db, workspaceId))
  ipcMain.handle('review:round', (_, workspaceId: number) => getRound(db, workspaceId))
  ipcMain.handle('review:wrap-up', (_, workspaceId: number) => wrapUp(db, workspaceId))
  ipcMain.handle('review:update-item', (_, id: number, body: string) => updateActionItem(db, id, body))
  ipcMain.handle('review:delete-item', (_, id: number) => deleteActionItem(db, id))
  ipcMain.handle('viewed:list', (_, workspaceId: number, mergeBase: string, head?: string) =>
    listViewed(db, workspaceId, mergeBase, head),
  )
  ipcMain.handle('viewed:set', (_, workspaceId: number, mergeBase: string, path: string, viewed: boolean, head?: string) =>
    setViewed(db, workspaceId, mergeBase, path, viewed, head),
  )
  ipcMain.handle('agents:run-turn', async (e, agentSessionId: string, message: string, noteIds: number[], roundId?: number) =>
    runTurn(db, agentSessionId, await formatAsk(db, noteIds, message, roundId), {}, (entry) => {
      if (!e.sender.isDestroyed()) e.sender.send('agents:entry', agentSessionId, entry)
    }),
  )
  // Resolves only on a click: the menu's close callback can run before the click, so it can't tell a dismissal
  // from a pick. A dismissed menu leaves the promise pending; nothing else waits on it.
  ipcMain.handle(
    'menus:navigator',
    (e, s: NavigatorSettings) =>
      new Promise<NavigatorSettings>((resolve) =>
        Menu.buildFromTemplate([
          { label: 'As Tree', type: 'radio', checked: s.layout === 'tree', click: () => resolve({ ...s, layout: 'tree' }) },
          { label: 'As List', type: 'radio', checked: s.layout === 'list', click: () => resolve({ ...s, layout: 'list' }) },
        ]).popup({ window: BrowserWindow.fromWebContents(e.sender) ?? undefined }),
      ),
  )
  // The Diff tab's commits: all changes, or one commit's diff. Resolves only on a click, like the menus above.
  ipcMain.handle('menus:commits', async (e, workspaceId: number, mergeBase: string, current: string | null) => {
    const listed = await listCommits(db, workspaceId, mergeBase)
    return new Promise<Commit | null>((resolve) =>
      Menu.buildFromTemplate([
        { label: 'All Changes', type: 'radio', checked: current === null, click: () => resolve(null) },
        { type: 'separator' },
        ...(listed.status !== 'ok'
          ? [{ label: `Couldn't list the commits: ${listed.message}`, enabled: false }]
          : listed.commits.map((c) => ({
              label: `${c.sha.slice(0, 7)}  ${c.subject}`,
              type: 'radio' as const,
              checked: c.sha === current,
              click: () => resolve(c),
            }))),
      ]).popup({ window: BrowserWindow.fromWebContents(e.sender) ?? undefined }),
    )
  })
  ipcMain.handle(
    'menus:view',
    (e, s: ViewSettings) =>
      new Promise<ViewSettings>((resolve) =>
        Menu.buildFromTemplate([
          { label: 'Unified', type: 'radio', checked: s.diffStyle === 'unified', click: () => resolve({ ...s, diffStyle: 'unified' }) },
          { label: 'Split', type: 'radio', checked: s.diffStyle === 'split', click: () => resolve({ ...s, diffStyle: 'split' }) },
          { type: 'separator' },
          {
            label: 'Show Viewed Files',
            type: 'checkbox',
            checked: s.showViewed,
            click: () => resolve({ ...s, showViewed: !s.showViewed }),
          },
        ]).popup({ window: BrowserWindow.fromWebContents(e.sender) ?? undefined }),
      ),
  )
  ipcMain.handle('guides:get', (_, workspaceId: number, mergeBase: string) => getGuide(db, workspaceId, mergeBase))
  ipcMain.handle('guides:create', (e, workspaceId: number, mergeBase: string, head: string, kind: 'all' | 'commit') =>
    createGuide(db, workspaceId, mergeBase, head, kind, (p) => {
      if (!e.sender.isDestroyed()) e.sender.send('guides:progress', workspaceId, p)
    }),
  )
  ipcMain.handle('guides:settings', () => getGuideSettings(db))
  ipcMain.handle('guides:set-settings', (_, s: GuideSettingsChange) => setGuideSettings(db, s))
  ipcMain.handle('agents:stop-turn', (_, agentSessionId: string) => stopTurn(agentSessionId))
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  stopAllTurns()
  stopGuides()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
