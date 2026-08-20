/**
 * Desktop RPC caller: the client-side half of the Electron IPC bridge,
 * paired with rpc-host.ts's createLocalFetchHandler on the Host side.
 */
import { describe, expect, it } from 'vitest'
import { createDesktopConnectionRpc } from '../src/client/rpc.ts'
import type { DesktopBridge, DesktopFetchRequest } from '../src/client/desktop-api-client.ts'

describe('createDesktopConnectionRpc', () => {
  it('carries a call over the desktop IPC bridge to the internal authority', async () => {
    let captured: DesktopFetchRequest | undefined
    const bridge: DesktopBridge = {
      request: async (request) => {
        captured = request
        const message = JSON.parse(request.body ?? '{}') as { rpcId: string }
        return {
          status: 200,
          headers: [['content-type', 'application/json']],
          body: new TextEncoder().encode(JSON.stringify({
            type: 'server-response',
            rpcId: message.rpcId,
            result: { ok: true, value: { ref: 'goal-1' } },
          })),
          stream: false,
        }
      },
      subscribe: () => () => undefined,
      abort: () => undefined,
    }
    const rpc = createDesktopConnectionRpc(bridge)

    await expect(rpc.call('/api', 'goals/create', { args: { agentId: 'agent-1' } }))
      .resolves.toEqual({ ok: true, value: { ref: 'goal-1' } })

    expect(captured?.url).toBe('http://dsh.internal/api/goals/create')
    expect(captured?.method).toBe('POST')
    expect(JSON.parse(captured?.body ?? '{}')).toMatchObject({
      type: 'client-request',
      method: 'goals/create',
      payload: { args: { agentId: 'agent-1' } },
    })
  })

  it('forwards caller cancellation to the desktop bridge using the request correlation id', async () => {
    const aborted: string[] = []
    let rejectRequest: ((error: Error) => void) | undefined
    const bridge: DesktopBridge = {
      request: () => new Promise((_resolve, reject) => { rejectRequest = reject }),
      subscribe: () => () => undefined,
      abort: (id) => {
        aborted.push(id)
        rejectRequest?.(new Error('aborted by caller'))
      },
    }
    const rpc = createDesktopConnectionRpc(bridge)
    const controller = new AbortController()

    const pending = rpc.call('/api', 'goals/create', {}, controller.signal)
    controller.abort()

    await expect(pending).rejects.toThrow('aborted by caller')
    expect(aborted).toHaveLength(1)
  })
})
