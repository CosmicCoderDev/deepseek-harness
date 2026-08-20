import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DESKTOP_PRESETS } from '../src/desktop-preset.ts'

const root = join(process.cwd(), 'config', 'agent-presets')

async function composition(id: string): Promise<string> {
  return await readFile(join(root, id, 'agent.cordis.yml'), 'utf8')
}

describe('desktop execution-mode presets', () => {
  it('ships every structured execution choice', () => {
    expect(DESKTOP_PRESETS).toEqual([
      'local-only', 'auto-select', 'codex-claude', 'codex-direct', 'claude-direct',
    ])
  })

  it('keeps local-only mode outside both cloud-provider boundaries', async () => {
    const value = await composition('local-only')
    expect(value).toMatch(/id: tool-subagent-codex[\s\S]*?disabled: true/)
    expect(value).toMatch(/id: tool-subagent-claude-code[\s\S]*?disabled: true/)
  })

  it('binds direct modes to the explicitly selected provider', async () => {
    const codex = await composition('codex-direct')
    const claude = await composition('claude-direct')
    expect(codex).toContain('immediately call subagent_codex')
    expect(codex).toMatch(/Treat a failed Codex call as a\s+failure/)
    expect(claude).toContain('immediately call subagent_claude_code')
    expect(claude).toMatch(/Treat a failed Claude\s+Code call as a failure/)
  })

  it('defines deterministic automatic routing and forbids silent fallback', async () => {
    const value = await composition('auto-select')
    expect(value).toContain('call subagent_codex for repository')
    expect(value).toContain('call subagent_claude_code for design')
    expect(value).toContain('Do not silently switch provider')
  })
})
