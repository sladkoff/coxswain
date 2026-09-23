import { contextBridge, ipcRenderer } from 'electron'
import type { CurrentUser } from '../core/github'

// The one interface between the UI and the core (ADR 0002).
const api = {
  currentUser: (): Promise<CurrentUser> => ipcRenderer.invoke('github:current-user'),
  onOpenSettings: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('open-settings', listener)
    return () => void ipcRenderer.off('open-settings', listener)
  },
}

export type CoxswainApi = typeof api

contextBridge.exposeInMainWorld('coxswain', api)
