// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import type { DshWindow } from '@deepseek-ai/dsh-client-modules/client'
import { readBootManifestWire } from '@deepseek-ai/dsh-client-web/src/boot.tsx'

afterEach(() => {
  delete (globalThis as DshWindow).__DSH_BOOT__
  document.head.replaceChildren()
})

describe('boot manifest carriers', () => {
  it('decodes inert Web Host metadata', () => {
    const graph = { rev: 'web', entries: [{ id: 'plugin', url: '/plugin.js', rev: 'one' }] }
    const metadata = document.createElement('meta')
    metadata.name = 'dsh-boot'
    metadata.content = Buffer.from(JSON.stringify(graph), 'utf8').toString('base64')
    document.head.append(metadata)
    expect(readBootManifestWire()).toEqual(graph)
  })

  it('prefers the native preload graph when both carriers exist', () => {
    const native = { rev: 'native', entries: [] }
    ;(globalThis as DshWindow).__DSH_BOOT__ = native
    const metadata = document.createElement('meta')
    metadata.name = 'dsh-boot'
    metadata.content = Buffer.from(JSON.stringify({ rev: 'web', entries: [] }), 'utf8').toString('base64')
    document.head.append(metadata)
    expect(readBootManifestWire()).toBe(native)
  })

  it('fails loudly on malformed metadata', () => {
    const metadata = document.createElement('meta')
    metadata.name = 'dsh-boot'
    metadata.content = 'bm90LWpzb24='
    document.head.append(metadata)
    expect(() => readBootManifestWire()).toThrow(/invalid dsh-boot metadata/)
  })
})
