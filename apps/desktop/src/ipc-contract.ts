/** Structured-clone-only contract between the desktop preload and main process. */

export interface DesktopFetchRequest {
  readonly id: string
  readonly url: string
  readonly method: string
  readonly headers: readonly [string, string][]
  readonly body?: string
}

export interface DesktopFetchResponse {
  readonly status: number
  readonly headers: readonly [string, string][]
  readonly body?: Uint8Array
  readonly stream: boolean
}

export type DesktopStreamEvent =
  | { readonly type: 'chunk'; readonly data: Uint8Array }
  | { readonly type: 'end' }
  | { readonly type: 'error'; readonly message: string }

export const IPC_FETCH = 'dsh:fetch'
export const IPC_ABORT = 'dsh:abort'
export const IPC_STREAM = 'dsh:stream'
export const IPC_BOOT = 'dsh:boot'
