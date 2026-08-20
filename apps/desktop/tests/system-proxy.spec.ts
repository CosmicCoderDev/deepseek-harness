import { describe, expect, it } from 'vitest'
import { parseMacosProxy } from '../src/system-proxy.ts'

describe('desktop macOS proxy import', () => {
  it('maps enabled HTTP, HTTPS, and SOCKS endpoints to CLI environment variables', () => {
    expect(parseMacosProxy(`
      HTTPEnable : 1
      HTTPPort : 7897
      HTTPProxy : 127.0.0.1
      HTTPSEnable : 1
      HTTPSPort : 7897
      HTTPSProxy : 127.0.0.1
      SOCKSEnable : 1
      SOCKSPort : 7897
      SOCKSProxy : 127.0.0.1
    `)).toEqual({
      HTTP_PROXY: 'http://127.0.0.1:7897',
      HTTPS_PROXY: 'http://127.0.0.1:7897',
      ALL_PROXY: 'socks5://127.0.0.1:7897',
      NO_PROXY: '127.0.0.1,localhost,::1,*.local',
    })
  })

  it('does not invent a proxy when every endpoint is disabled', () => {
    expect(parseMacosProxy('HTTPEnable : 0\nHTTPProxy : 127.0.0.1\nHTTPPort : 7897'))
      .toEqual({})
  })
})
