import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applySubagentPermission,
  readDesktopSettings,
  readDesktopSettingsWithRecovery,
  validateDesktopSettings,
  writeDesktopSettings,
} from '../src/desktop-settings.ts'

describe('desktop settings', () => {
  it.each([
    ['read-only', 'never', 'plan'],
    ['project-development', 'approve-for-me', 'acceptEdits'],
    ['full-access', 'dangerously-bypass-approvals-and-sandbox', 'bypassPermissions'],
  ] as const)('maps %s to provider-native modes', (permission, codex, claude) => {
    const environment: NodeJS.ProcessEnv = {}
    applySubagentPermission(permission, environment)
    expect(environment.DSH_CODEX_PERMISSION_MODE).toBe(codex)
    expect(environment.DSH_CLAUDE_PERMISSION_MODE).toBe(claude)
  })

  it('rejects invalid IPC values', () => {
    expect(() => validateDesktopSettings({ version: 1, proxy: { mode: 'direct' }, subagentPermission: 'root' })).toThrow('权限')
    expect(() => validateDesktopSettings({ version: 1, proxy: { mode: 'manual', url: 'bad' }, subagentPermission: 'read-only' })).toThrow('代理')
  })

  it('migrates the former proxy-only preference into versioned settings', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-settings-migration-'))
    try {
      await writeFile(join(home, 'desktop-proxy.json'), '{"mode":"manual","url":"http://127.0.0.1:7897"}\n')
      const settings = await readDesktopSettings(home)
      expect(settings).toEqual({
        version: 1,
        proxy: { mode: 'manual', url: 'http://127.0.0.1:7897' },
        subagentPermission: 'read-only',
        localModels: { coding: 'qwen3-coder:30b', vision: 'qwen3-vl:8b' },
      })
      expect(JSON.parse(await readFile(join(home, 'desktop-settings.json'), 'utf8'))).toEqual(settings)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('round-trips validated settings through the private settings file', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-settings-write-'))
    try {
      const settings = {
        version: 1 as const,
        proxy: { mode: 'direct' as const },
        subagentPermission: 'project-development' as const,
        localModels: { coding: 'qwen3-coder:30b', vision: 'qwen3-vl:8b' },
      }
      await writeDesktopSettings(home, settings)
      await expect(readDesktopSettings(home)).resolves.toEqual(settings)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('preserves a corrupt settings file and restores safe defaults', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-settings-corrupt-'))
    try {
      await writeFile(join(home, 'desktop-settings.json'), '{not-json}\n')
      const result = await readDesktopSettingsWithRecovery(home)
      expect(result.settings).toEqual({ version: 1, proxy: { mode: 'system' }, subagentPermission: 'read-only', localModels: { coding: 'qwen3-coder:30b', vision: 'qwen3-vl:8b' } })
      expect(result.recoveryWarning).toContain('已保留原文件')
      expect(await readFile(result.recoveredFile!, 'utf8')).toBe('{not-json}\n')
      expect(JSON.parse(await readFile(join(home, 'desktop-settings.json'), 'utf8'))).toEqual(result.settings)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})
