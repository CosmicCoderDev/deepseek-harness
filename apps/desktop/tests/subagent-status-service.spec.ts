import { describe, expect, it, vi } from 'vitest'
import { SubagentStatusService } from '../src/subagent-status-service.ts'

const status = {
  codex: { installed: true, authenticated: true, detail: 'ok' },
  claude: { installed: true, authenticated: false, detail: '未登录' },
  proxy: 'direct',
}

describe('subagent status service', () => {
  it('coalesces concurrent refreshes and caches the result', async () => {
    let release!: () => void
    const inspect = vi.fn(async () => {
      await new Promise<void>((resolve) => { release = resolve })
      return status
    })
    const service = new SubagentStatusService(inspect, () => {}, () => new Date('2026-08-20T00:00:00Z'))
    const first = service.refresh()
    const second = service.refresh()
    expect(inspect).toHaveBeenCalledTimes(1)
    release()
    await expect(first).resolves.toEqual(await second)
    await service.get()
    expect(inspect).toHaveBeenCalledTimes(1)
  })

  it('publishes each completed explicit refresh', async () => {
    const changed = vi.fn()
    const service = new SubagentStatusService(async () => status, changed)
    await service.refresh()
    await service.refresh()
    expect(changed).toHaveBeenCalledTimes(2)
  })
})
