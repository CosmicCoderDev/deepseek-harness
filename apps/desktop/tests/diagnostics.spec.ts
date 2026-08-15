import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  exportDesktopDiagnostics,
  initializeDesktopDiagnostics,
  recordDesktopDiagnostic,
  redactDiagnosticText,
} from '../src/diagnostics.ts'

describe('desktop diagnostics', () => {
  it('redacts common credentials', () => {
    const value = redactDiagnosticText('Authorization: Bearer secret.abc apiKey=sk-live password: hunter2')
    expect(value).not.toContain('secret.abc')
    expect(value).not.toContain('sk-live')
    expect(value).not.toContain('hunter2')
    expect(value).toContain('[REDACTED]')
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
