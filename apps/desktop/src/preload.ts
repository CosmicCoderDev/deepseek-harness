/** Context-isolated renderer bridge: no Node or Electron objects cross this boundary. */

import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_ABORT,
  IPC_BOOT,
  IPC_FETCH,
  IPC_STREAM,
  IPC_SETTINGS_COPY_DIAGNOSTICS,
  IPC_SETTINGS_GET,
  IPC_SETTINGS_OPEN_LOGS,
  IPC_SETTINGS_LOGIN,
  IPC_SETTINGS_REFRESH_STATUS,
  IPC_SETTINGS_RESTART_HOST,
  IPC_SETTINGS_STATUS_CHANGED,
  IPC_SETTINGS_SAVE,
  IPC_SETTINGS_TEST,
  IPC_PROJECT_POLICY_DELETE,
  IPC_PROJECT_POLICY_GET,
  IPC_PROJECT_POLICY_SAVE,
  IPC_PROJECT_POLICY_SELECT,
  type DesktopProjectPolicyValue,
  type DesktopProjectPolicyView,
  type DesktopSettingsView,
  type DesktopSubagentProduct,
  type DesktopFetchRequest,
  type DesktopFetchResponse,
  type DesktopStreamEvent,
} from './ipc-contract.ts'

type StreamListener = (event: DesktopStreamEvent) => void
const listeners = new Map<string, StreamListener>()
const pending = new Map<string, DesktopStreamEvent[]>()

ipcRenderer.on(IPC_STREAM, (_event, id: unknown, message: unknown) => {
  if (typeof id !== 'string' || !isStreamEvent(message)) return
  const listener = listeners.get(id)
  if (listener !== undefined) {
    listener(message)
    if (message.type !== 'chunk') listeners.delete(id)
    return
  }
  const queue = pending.get(id) ?? []
  if (queue.length < 256) queue.push(message)
  pending.set(id, queue)
})

const graph: unknown = ipcRenderer.sendSync(IPC_BOOT)
contextBridge.exposeInMainWorld('__DSH_BOOT__', graph)
contextBridge.exposeInMainWorld('__DSH_DESKTOP__', {
  request: (request: DesktopFetchRequest): Promise<DesktopFetchResponse> =>
    ipcRenderer.invoke(IPC_FETCH, request) as Promise<DesktopFetchResponse>,
  subscribe(id: string, listener: StreamListener): () => void {
    listeners.set(id, listener)
    const queue = pending.get(id)
    pending.delete(id)
    if (queue !== undefined) {
      for (const message of queue) listener(message)
      if (queue.some(message => message.type !== 'chunk')) listeners.delete(id)
    }
    return () => { listeners.delete(id) }
  },
  abort(id: string): void { ipcRenderer.send(IPC_ABORT, id) },
})
contextBridge.exposeInMainWorld('__DSH_SETTINGS__', {
  get: (): Promise<DesktopSettingsView> => ipcRenderer.invoke(IPC_SETTINGS_GET) as Promise<DesktopSettingsView>,
  save: (settings: DesktopSettingsView['settings'], confirmFullAccess: boolean): Promise<DesktopSettingsView> =>
    ipcRenderer.invoke(IPC_SETTINGS_SAVE, settings, confirmFullAccess) as Promise<DesktopSettingsView>,
  test: (): Promise<string> => ipcRenderer.invoke(IPC_SETTINGS_TEST) as Promise<string>,
  copyDiagnostics: (): Promise<void> => ipcRenderer.invoke(IPC_SETTINGS_COPY_DIAGNOSTICS) as Promise<void>,
  openLogs: (): Promise<void> => ipcRenderer.invoke(IPC_SETTINGS_OPEN_LOGS) as Promise<void>,
  login: (product: DesktopSubagentProduct): Promise<void> => ipcRenderer.invoke(IPC_SETTINGS_LOGIN, product) as Promise<void>,
  refreshStatus: (): Promise<DesktopSettingsView> => ipcRenderer.invoke(IPC_SETTINGS_REFRESH_STATUS) as Promise<DesktopSettingsView>,
  restartHost: (): Promise<DesktopSettingsView> => ipcRenderer.invoke(IPC_SETTINGS_RESTART_HOST) as Promise<DesktopSettingsView>,
  selectProject: (): Promise<string | undefined> => ipcRenderer.invoke(IPC_PROJECT_POLICY_SELECT) as Promise<string | undefined>,
  getProjectPolicy: (projectRoot: string): Promise<DesktopProjectPolicyView> =>
    ipcRenderer.invoke(IPC_PROJECT_POLICY_GET, projectRoot) as Promise<DesktopProjectPolicyView>,
  saveProjectPolicy: (policy: DesktopProjectPolicyValue, confirmExpansion: boolean): Promise<DesktopProjectPolicyView> =>
    ipcRenderer.invoke(IPC_PROJECT_POLICY_SAVE, policy, confirmExpansion) as Promise<DesktopProjectPolicyView>,
  deleteProjectPolicy: (projectRoot: string): Promise<DesktopProjectPolicyView> =>
    ipcRenderer.invoke(IPC_PROJECT_POLICY_DELETE, projectRoot) as Promise<DesktopProjectPolicyView>,
  onStatusChanged(listener: () => void): () => void {
    const wrapped = (): void => { listener() }
    ipcRenderer.on(IPC_SETTINGS_STATUS_CHANGED, wrapped)
    return () => { ipcRenderer.removeListener(IPC_SETTINGS_STATUS_CHANGED, wrapped) }
  },
})

function isStreamEvent(value: unknown): value is DesktopStreamEvent {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false
  const type = (value as { type?: unknown }).type
  if (type === 'end') return true
  if (type === 'error') return typeof (value as { message?: unknown }).message === 'string'
  return type === 'chunk' && (value as { data?: unknown }).data instanceof Uint8Array
}
