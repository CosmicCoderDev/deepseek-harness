import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  explainDesktopError,
  exportDesktopDiagnostics,
  initializeDesktopDiagnostics,
  recordDesktopDiagnostic,
  redactDiagnosticText,
} from '../src/diagnostics.ts'

describe('desktop diagnostics', () => {
  it('redacts common credentials', () => {
    const value = redactDiagnosticText('Authorization: Bearer secret.abc apiKey=sk-live password: hunter2 email=user@example.com https://example.com/callback?code=oauth-secret&state=session-secret')
    expect(value).not.toContain('secret.abc')
    expect(value).not.toContain('sk-live')
    expect(value).not.toContain('hunter2')
    expect(value).not.toContain('user@example.com')
    expect(value).not.toContain('oauth-secret')
    expect(value).not.toContain('session-secret')
    expect(value).toContain('[REDACTED]')
  })

  it('explains common provider failures', () => {
    expect(explainDesktopError('Codex', new Error('ELECTRON_RUN_AS_NODE missing')).title).toBe('Codex 启动失败')
    expect(explainDesktopError('Claude Code', new Error('authentication failed')).title).toBe('Claude Code 登录失效')
    expect(explainDesktopError('Network', new Error('request timed out')).action).toContain('代理')
  })

  it('exports metadata and the redacted log tail', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-desktop-diagnostics-'))
    await initializeDesktopDiagnostics(dir)
    recordDesktopDiagnostic('error', 'request failed', 'token=private-value')
    const target = join(dir, 'report.txt')
    await exportDesktopDiagnostics(target, { version: 'test', platform: 'darwin-arm64' })
    const report = await readFile(target, 'utf8')
    expect(report).toContain('version: test')
    expect(report).toContain('request failed')
    expect(report).not.toContain('private-value')
  })
})
