import { describe, expect, it } from 'vitest'
import {
  DesktopSubagentProviderRegistry,
  desktopSubagentProviders,
  type DesktopSubagentProvider,
} from '../src/subagent-provider-registry.ts'

function fake(id: 'codex' | 'claude'): DesktopSubagentProvider {
  return {
    id,
    displayName: id,
    capabilities: ['read-only'],
    supportedPlatforms: ['darwin'],
    connectivityUrl: 'https://example.test',
    inspect: async () => ({ installed: true, authenticated: true, detail: 'ok' }),
    loginCommand: () => 'login',
    permissionMode: () => 'safe',
    applyPermission: () => undefined,
  }
}

describe('desktop subagent provider registry', () => {
  it('publishes the two bundled providers in stable order', () => {
    expect(desktopSubagentProviders.list().map(provider => provider.id)).toEqual(['codex', 'claude'])
    expect(desktopSubagentProviders.get('codex').displayName).toBe('Codex')
    expect(desktopSubagentProviders.get('claude').displayName).toBe('Claude Code')
  })

  it('rejects duplicate ids and unknown capabilities', () => {
    const registry = new DesktopSubagentProviderRegistry()
    registry.register(fake('codex'))
    expect(() => registry.register(fake('codex'))).toThrow('重复')
    const invalid = { ...fake('claude'), capabilities: ['remote-module-path'] } as unknown as DesktopSubagentProvider
    expect(() => registry.register(invalid)).toThrow('未知')
  })

  it('owns native permission mappings', () => {
    expect(desktopSubagentProviders.get('codex').permissionMode('project-development')).toBe('approve-for-me')
    expect(desktopSubagentProviders.get('claude').permissionMode('full-access')).toBe('bypassPermissions')
  })
})
