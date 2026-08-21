import { describe, expect, it } from 'vitest'
import {
  applyProxySettings,
  formatProxySnapshot,
  projectProxyEnvironment,
  validateProxyUrl,
} from '../src/proxy-settings.ts'

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

  it('projects project modes with explicit tombstones and local bypass', () => {
    const base = { TOKEN: 'kept', HTTP_PROXY: 'http://provider:1' }
    const inherited = { HTTPS_PROXY: 'http://global:7897' }
    const inheritedEnvironment = projectProxyEnvironment({ mode: 'inherit' }, inherited, base)
    expect(inheritedEnvironment.TOKEN).toBe('kept')
    expect(inheritedEnvironment.HTTP_PROXY).toBeUndefined()
    expect(inheritedEnvironment.HTTPS_PROXY).toBe('http://global:7897')
    expect(inheritedEnvironment.https_proxy).toBe('http://global:7897')
    expect(inheritedEnvironment.NO_PROXY).toContain('localhost')
    expect(projectProxyEnvironment({ mode: 'direct' }, inherited, base)).toMatchObject({
      TOKEN: 'kept',
      HTTP_PROXY: undefined,
      HTTPS_PROXY: undefined,
      ALL_PROXY: undefined,
    })
    expect(projectProxyEnvironment(
      { mode: 'system' },
      inherited,
      base,
      () => ({ ALL_PROXY: 'socks5://system:1080' }),
    )).toMatchObject({ ALL_PROXY: 'socks5://system:1080', all_proxy: 'socks5://system:1080' })
    expect(projectProxyEnvironment(
      { mode: 'manual', url: 'http://project:8080' },
      inherited,
      base,
    )).toMatchObject({ HTTP_PROXY: 'http://project:8080', HTTPS_PROXY: 'http://project:8080' })
  })
})
