import { describe, expect, it } from 'vitest'
import { applyProxySettings, formatProxySnapshot, validateProxyUrl } from '../src/proxy-settings.ts'

describe('desktop proxy settings', () => {
  it('applies manual proxies and always bypasses local services', () => {
    const environment: NodeJS.ProcessEnv = { HTTPS_PROXY: 'http://old:1' }
    const snapshot = applyProxySettings({ mode: 'manual', url: 'http://127.0.0.1:7897' }, environment)
    expect(environment.HTTPS_PROXY).toBe('http://127.0.0.1:7897')
    expect(environment.NO_PROXY).toContain('localhost')
    expect(snapshot.environment.NO_PROXY).toContain('127.0.0.1')
  })

  it('removes injected remote proxies in direct mode', () => {
    const environment: NodeJS.ProcessEnv = { HTTP_PROXY: 'http://old:1', ALL_PROXY: 'socks5://old:2' }
    applyProxySettings({ mode: 'direct' }, environment)
    expect(environment.HTTP_PROXY).toBeUndefined()
    expect(environment.ALL_PROXY).toBeUndefined()
    expect(environment.NO_PROXY).toContain('::1')
  })

  it('rejects incomplete proxy addresses', () => {
    expect(() => validateProxyUrl('127.0.0.1:7897')).toThrow('格式无效')
    expect(() => validateProxyUrl('http://localhost')).toThrow('主机和端口')
  })

  it('hides credentials in summaries', () => {
    const text = formatProxySnapshot(applyProxySettings({
      mode: 'manual',
      url: 'http://alice:secret@127.0.0.1:7897',
    }, {}))
    expect(text).not.toContain('alice')
    expect(text).not.toContain('secret')
  })
})
