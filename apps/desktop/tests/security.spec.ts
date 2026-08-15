import { describe, expect, it } from 'vitest'
import {
  isSafeExternalUrl,
  parseDesktopFetchRequest,
  parsePluginBundleUrl,
} from '../src/security.ts'

describe('desktop renderer security boundary', () => {
  it('accepts an internal Fetch-shaped request', () => {
    const request = {
      id: '12345678-abcd',
      url: 'http://dsh.internal/api/session.list',
      method: 'POST',
      headers: [['content-type', 'application/json']],
      body: '{}',
    }

    expect(parseDesktopFetchRequest(request)).toEqual(request)
  })

  it.each([
    null,
    { id: 'short', url: 'http://dsh.internal/api', method: 'GET', headers: [] },
    { id: '12345678', url: 42, method: 'GET', headers: [] },
    { id: '12345678', url: 'http://dsh.internal/api', method: 'GET', headers: [['broken']] },
  ])('rejects a malformed IPC request: %j', (value) => {
    expect(() => parseDesktopFetchRequest(value)).toThrow('malformed IPC request')
  })

  it.each([
    ['not a URL', 'malformed IPC request URL'],
    ['http://example.com/api', 'rejected IPC request target'],
  ])('rejects an invalid IPC request destination: %s', (url, message) => {
    expect(() => parseDesktopFetchRequest({
      id: '12345678', url, method: 'GET', headers: [],
    })).toThrow(message)
  })

  it('rejects unsupported methods and oversized request bodies', () => {
    expect(() => parseDesktopFetchRequest({
      id: '12345678', url: 'http://dsh.internal/api', method: 'DELETE', headers: [],
    })).toThrow('rejected IPC request target')
    expect(() => parseDesktopFetchRequest({
      id: '12345678', url: 'http://dsh.internal/api', method: 'POST', headers: [], body: 'large',
    }, 4)).toThrow('request body exceeds the configured limit')
  })

  it('opens only ordinary external browser destinations', () => {
    expect(isSafeExternalUrl('https://example.com/docs')).toBe(true)
    expect(isSafeExternalUrl('mailto:support@example.com')).toBe(true)
    expect(isSafeExternalUrl('file:///Users/example/.ssh/id_ed25519')).toBe(false)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
  })

  it('accepts only manifest plugin JavaScript and source-map URLs', () => {
    expect(parsePluginBundleUrl('dsh-plugin://bundle/%40scope%2Fplugin/client.js?rev=1'))
      .toEqual({ id: '@scope/plugin', sourceMap: false })
    expect(parsePluginBundleUrl('dsh-plugin://bundle/plugin/client.js.map'))
      .toEqual({ id: 'plugin', sourceMap: true })
    expect(parsePluginBundleUrl('dsh-plugin://other/plugin/client.js')).toBeUndefined()
    expect(parsePluginBundleUrl('dsh-plugin://bundle/plugin/package.json')).toBeUndefined()
    expect(parsePluginBundleUrl('not a URL')).toBeUndefined()
  })
})
