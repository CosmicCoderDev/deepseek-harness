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
})
