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
  IPC_SETTINGS_TEST_VISION,
  IPC_SETTINGS_PULL_VISION,
  IPC_SETTINGS_CANCEL_VISION_PULL,
  IPC_SETTINGS_VISION_PULL_PROGRESS,
  IPC_PROJECT_POLICY_DELETE,
  IPC_PROJECT_POLICY_GET,
  IPC_PROJECT_POLICY_SAVE,
  IPC_PROJECT_POLICY_SELECT,
  IPC_PROJECT_POLICY_RESOLVE,
  type DesktopProjectPolicyResolution,
  type DesktopProjectPolicyValue,
  type DesktopProjectPolicyView,
  type DesktopSettingsView,
  type DesktopVisionPullProgress,
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
  resolveProjectPolicy: (projectRoot: string): Promise<DesktopProjectPolicyResolution | undefined> =>
    ipcRenderer.invoke(IPC_PROJECT_POLICY_RESOLVE, projectRoot) as Promise<DesktopProjectPolicyResolution | undefined>,
})
contextBridge.exposeInMainWorld('__DSH_SETTINGS__', {
  get: (): Promise<DesktopSettingsView> => ipcRenderer.invoke(IPC_SETTINGS_GET) as Promise<DesktopSettingsView>,
  save: (settings: DesktopSettingsView['settings'], confirmFullAccess: boolean): Promise<DesktopSettingsView> =>
    ipcRenderer.invoke(IPC_SETTINGS_SAVE, settings, confirmFullAccess) as Promise<DesktopSettingsView>,
  test: (): Promise<string> => ipcRenderer.invoke(IPC_SETTINGS_TEST) as Promise<string>,
  testVision: (): Promise<string> => ipcRenderer.invoke(IPC_SETTINGS_TEST_VISION) as Promise<string>,
  pullVision: (confirmDownload: boolean): Promise<DesktopSettingsView> =>
    ipcRenderer.invoke(IPC_SETTINGS_PULL_VISION, confirmDownload) as Promise<DesktopSettingsView>,
  cancelVisionPull: (): Promise<void> => ipcRenderer.invoke(IPC_SETTINGS_CANCEL_VISION_PULL) as Promise<void>,
  onVisionPullProgress(listener: (progress: DesktopVisionPullProgress) => void): () => void {
    const wrapped = (_event: Electron.IpcRendererEvent, progress: DesktopVisionPullProgress): void => { listener(progress) }
    ipcRenderer.on(IPC_SETTINGS_VISION_PULL_PROGRESS, wrapped)
    return () => { ipcRenderer.removeListener(IPC_SETTINGS_VISION_PULL_PROGRESS, wrapped) }
  },
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
