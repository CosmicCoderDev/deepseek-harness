import { describe, expect, it } from 'vitest'
import { isSafeExternalUrl, parseLoopbackUrl, parseReadyLine } from '../src/backend.ts'

describe('desktop backend trust boundary', () => {
  it('accepts the dsh readiness URL and ignores other output', () => {
    expect(parseReadyLine('loader: ready')).toBeUndefined()
    expect(parseReadyLine('dsh web: http://127.0.0.1:49152')).toEqual(new URL('http://127.0.0.1:49152'))
    expect(parseReadyLine('dsh web: http://localhost:3080 (LAN: http://10.0.0.2:3080)'))
      .toEqual(new URL('http://localhost:3080'))
  })

  it.each([
    'https://127.0.0.1:3080',
    'http://example.com:3080',
    'file:///tmp/index.html',
    'http://user:pass@127.0.0.1:3080',
  ])('rejects a non-loopback or privileged backend URL: %s', (value) => {
    expect(() => parseLoopbackUrl(value)).toThrow('backend URL must be loopback HTTP')
  })

  it('opens only ordinary external browser destinations', () => {
    expect(isSafeExternalUrl('https://example.com/docs')).toBe(true)
    expect(isSafeExternalUrl('mailto:support@example.com')).toBe(true)
    expect(isSafeExternalUrl('file:///Users/example/.ssh/id_ed25519')).toBe(false)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
  })
})
