/** Context-isolated renderer bridge: no Node or Electron objects cross this boundary. */

import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_ABORT,
  IPC_BOOT,
  IPC_FETCH,
  IPC_STREAM,
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

function isStreamEvent(value: unknown): value is DesktopStreamEvent {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false
  const type = (value as { type?: unknown }).type
  if (type === 'end') return true
  if (type === 'error') return typeof (value as { message?: unknown }).message === 'string'
  return type === 'chunk' && (value as { data?: unknown }).data instanceof Uint8Array
}
