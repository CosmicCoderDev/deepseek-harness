/** Electron IPC carrier for the transport-neutral API client. */

import { AbstractApiClient } from './api.ts'

const INTERNAL_BASE = 'http://dsh.internal'

/** Request shape accepted by the context-isolated desktop preload. */
export interface DesktopFetchRequest {
  readonly id: string
  readonly url: string
  readonly method: string
  readonly headers: readonly [string, string][]
  readonly body?: string
}

/** One streamed response event delivered by the desktop preload. */
export type DesktopStreamEvent =
  | { readonly type: 'chunk'; readonly data: Uint8Array }
  | { readonly type: 'end' }
  | { readonly type: 'error'; readonly message: string }

/** Complete response metadata returned over IPC. */
export interface DesktopFetchResponse {
  readonly status: number
  readonly headers: readonly [string, string][]
  readonly body?: Uint8Array
  readonly stream: boolean
}

/** Least-authority API exposed by Electron's isolated preload. */
export interface DesktopBridge {
  request(request: DesktopFetchRequest): Promise<DesktopFetchResponse>
  subscribe(id: string, listener: (event: DesktopStreamEvent) => void): () => void
  abort(id: string): void
}

/** Return the native bridge only when the trusted preload installed it. */
export function desktopBridge(): DesktopBridge | undefined {
  return (globalThis as typeof globalThis & { __DSH_DESKTOP__?: DesktopBridge }).__DSH_DESKTOP__
}

/** Execute one Fetch-shaped request over the least-authority desktop bridge. */
export async function desktopFetch(
  bridge: DesktopBridge,
  input: URL,
  init?: RequestInit,
): Promise<Response> {
  const id = crypto.randomUUID()
  const signal = init?.signal ?? undefined
  if (signal?.aborted === true) throw abortError(signal)
  const onAbort = (): void => { bridge.abort(id) }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const response = await bridge.request({
      id,
      url: input.href,
      method: init?.method ?? 'GET',
      headers: [...new Headers(init?.headers).entries()],
      ...(typeof init?.body === 'string' ? { body: init.body } : {}),
    })
    if (!response.stream) {
      signal?.removeEventListener('abort', onAbort)
      return new Response(response.body === undefined ? null : Uint8Array.from(response.body).buffer, {
        status: response.status,
        headers: [...response.headers],
      })
    }
    let unsubscribe: (() => void) | undefined
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        unsubscribe = bridge.subscribe(id, (event) => {
          if (event.type === 'chunk') controller.enqueue(event.data)
          else {
            signal?.removeEventListener('abort', onAbort)
            if (event.type === 'end') controller.close()
            else controller.error(new Error(event.message))
          }
        })
      },
      cancel() {
        unsubscribe?.()
        signal?.removeEventListener('abort', onAbort)
        bridge.abort(id)
      },
    })
    return new Response(body, { status: response.status, headers: [...response.headers] })
  } catch (error) {
    signal?.removeEventListener('abort', onAbort)
    throw error
  }
}

/** Native API client whose protocol behavior remains in AbstractApiClient. */
export class DesktopApiClient extends AbstractApiClient {
  constructor(private readonly bridge: DesktopBridge, timeoutMs?: number) {
    super(timeoutMs)
  }

  protected doFetch(input: URL, init?: RequestInit): Promise<Response> {
    return desktopFetch(this.bridge, input, init)
  }

  /** A file-loaded renderer never supplies network authority to the native carrier. */
  protected override resolveBase(): string {
    return INTERNAL_BASE
  }
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('This operation was aborted')
}
