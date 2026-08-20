import { describe, expect, it } from 'vitest'
import {
  DesktopApiClient,
  desktopFetch,
  type DesktopBridge,
  type DesktopFetchRequest,
  type DesktopStreamEvent,
} from '../src/client/desktop-api-client.ts'

describe('desktop IPC Fetch carrier', () => {
  it('uses the fixed internal authority even from a file-loaded renderer', async () => {
    let captured: DesktopFetchRequest | undefined
    const bridge: DesktopBridge = {
      async request(request) {
        captured = request
        const message = JSON.parse(request.body ?? '{}') as { rpcId: string }
        return {
          status: 200,
          headers: [['content-type', 'application/json']],
          body: new TextEncoder().encode(JSON.stringify({
            type: 'server-response',
            rpcId: message.rpcId,
            result: { ok: true, value: { items: [] } },
          })),
          stream: false,
        }
      },
      subscribe: () => () => undefined,
      abort: () => undefined,
    }

    await new DesktopApiClient(bridge).sessions.list({})

    expect(captured?.url).toBe('http://dsh.internal/api/session.list')
    expect(captured?.method).toBe('POST')
  })

  it('reconstructs a streamed response from IPC chunks', async () => {
    const chunks = [new TextEncoder().encode('first'), new TextEncoder().encode('-second')]
    const bridge: DesktopBridge = {
      request: async () => ({ status: 200, headers: [['content-type', 'text/plain']], stream: true }),
      subscribe(_id, listener) {
        queueMicrotask(() => {
          for (const data of chunks) listener({ type: 'chunk', data })
          listener({ type: 'end' })
        })
        return () => undefined
      },
      abort: () => undefined,
    }

    const response = await desktopFetch(bridge, new URL('http://dsh.internal/api/events.host'))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('first-second')
  })

  it('forwards cancellation to the preload bridge', async () => {
    let listener: ((event: DesktopStreamEvent) => void) | undefined
    const aborted: string[] = []
    const bridge: DesktopBridge = {
      request: async () => ({ status: 200, headers: [], stream: true }),
      subscribe(_id, next) {
        listener = next
        return () => { listener = undefined }
      },
      abort: (id) => { aborted.push(id) },
    }
    const response = await desktopFetch(bridge, new URL('http://dsh.internal/api/events.mux'))

    await response.body?.cancel()

    expect(listener).toBeUndefined()
    expect(aborted).toHaveLength(1)
  })

  it('throws immediately for an already-aborted signal, keeping an Error reason as-is', async () => {
    const bridge: DesktopBridge = {
      request: async () => { throw new Error('must not reach the bridge') },
      subscribe: () => () => undefined,
      abort: () => undefined,
    }
    const controller = new AbortController()
    const reason = new Error('cancelled by caller')
    controller.abort(reason)

    await expect(desktopFetch(bridge, new URL('http://dsh.internal/api/session.list'), { signal: controller.signal }))
      .rejects.toBe(reason)
  })

  it('falls back to a generic abort error when the signal reason is not an Error', async () => {
    const bridge: DesktopBridge = {
      request: async () => { throw new Error('must not reach the bridge') },
      subscribe: () => () => undefined,
      abort: () => undefined,
    }
    const controller = new AbortController()
    controller.abort('cancelled') // non-Error reason

    await expect(desktopFetch(bridge, new URL('http://dsh.internal/api/session.list'), { signal: controller.signal }))
      .rejects.toThrow('This operation was aborted')
  })

  it('returns a null-bodied Response when the IPC layer reports no body', async () => {
    const bridge: DesktopBridge = {
      request: async () => ({ status: 204, headers: [], stream: false }),
      subscribe: () => () => undefined,
      abort: () => undefined,
    }

    const response = await desktopFetch(bridge, new URL('http://dsh.internal/api/session.list'))

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
  })

  it('errors the stream when the preload reports a stream error', async () => {
    const bridge: DesktopBridge = {
      request: async () => ({ status: 200, headers: [], stream: true }),
      subscribe(_id, listener) {
        queueMicrotask(() => { listener({ type: 'error', message: 'ipc broke' }) })
        return () => undefined
      },
      abort: () => undefined,
    }

    const response = await desktopFetch(bridge, new URL('http://dsh.internal/api/events.host'))

    await expect(response.text()).rejects.toThrow('ipc broke')
  })

  it('propagates a bridge.request failure and detaches its abort listener', async () => {
    const aborted: string[] = []
    const bridge: DesktopBridge = {
      request: async () => { throw new Error('ipc transport down') },
      subscribe: () => () => undefined,
      abort: (id) => { aborted.push(id) },
    }
    const controller = new AbortController()

    await expect(desktopFetch(bridge, new URL('http://dsh.internal/api/session.list'), { signal: controller.signal }))
      .rejects.toThrow('ipc transport down')

    // The listener registered before the request must be gone: aborting after
    // the rejection must not still reach the bridge.
    controller.abort()
    expect(aborted).toHaveLength(0)
  })
})
