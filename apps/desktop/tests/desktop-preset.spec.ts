import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DESKTOP_PRESETS, ensureDesktopPreset } from '../src/desktop-preset.ts'

describe('desktop preset installer', () => {
  it('fails loud when a bundled preset source is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-preset-missing-'))
    await expect(ensureDesktopPreset(join(root, 'missing-config'), join(root, 'home')))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('installs once and never overwrites a user-edited preset', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-preset-'))
    const home = join(root, 'home')
    for (const preset of DESKTOP_PRESETS) {
      const source = join(root, 'config', 'agent-presets', preset)
      await mkdir(source, { recursive: true })
      await writeFile(join(source, 'agent.cordis.yml'), 'template')
      await writeFile(join(source, 'preset.yml'), 'name: test')
    }
    await expect(ensureDesktopPreset(join(root, 'config'), home)).resolves.toBe(true)
    const target = join(home, '.agent-presets', 'codex-claude', 'agent.cordis.yml')
    await writeFile(target, 'user edit')
    await expect(ensureDesktopPreset(join(root, 'config'), home)).resolves.toBe(false)
    await expect(readFile(target, 'utf8')).resolves.toBe('user edit')
    await expect(readFile(join(home, '.agent-presets', 'auto-select', 'agent.cordis.yml'), 'utf8'))
      .resolves.toBe('template')
    await expect(readFile(join(home, '.agent-presets', 'local-only', 'agent.cordis.yml'), 'utf8'))
      .resolves.toBe('template')
  })

  it('upgrades known unmodified desktop prompts but preserves unknown copies', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-preset-upgrade-'))
    const home = join(root, 'home')
    for (const preset of DESKTOP_PRESETS) {
      const source = join(root, 'config', 'agent-presets', preset)
      const target = join(home, '.agent-presets', preset)
      await mkdir(source, { recursive: true })
      await mkdir(target, { recursive: true })
      await writeFile(join(source, 'agent.cordis.yml'), 'next template')
      await writeFile(join(source, 'preset.yml'), 'name: next')
      await writeFile(join(target, 'agent.cordis.yml'), 'user edit')
      await writeFile(join(target, 'preset.yml'), 'name: user')
    }

    // The test uses the exact previously shipped local-only template so the
    // production legacy-hash gate, rather than a test-only seam, is exercised.
    const previous = await readFile(new URL('../config/agent-presets/local-only/agent.cordis.yml', import.meta.url), 'utf8')
    const legacyPrompt = previous
      .replace('model and locally available tools. You can directly inspect and operate on the user\'s actual\n      machine and workspace through the tools listed in this session. The permission selector controls\n      which tool operations are authorized; Full access permits the broadest tool execution and is not\n      a reason to refuse inspection. For environment facts, use tools before answering. A successful\n      tool result is direct observed evidence: report what it proves and never follow it with a claim\n      that you cannot access, inspect, or run tools on the local machine. If a tool fails, report the\n      exact failure instead of inventing a general limitation. Codex and Claude Code are outside this session\'s execution', 'model and locally available tools. Codex and Claude Code are outside this session\'s execution')
    const localTarget = join(home, '.agent-presets', 'local-only', 'agent.cordis.yml')
    await writeFile(localTarget, legacyPrompt)

    await expect(ensureDesktopPreset(join(root, 'config'), home)).resolves.toBe(true)
    await expect(readFile(localTarget, 'utf8')).resolves.toBe('next template')
    await expect(readFile(join(home, '.agent-presets', 'auto-select', 'agent.cordis.yml'), 'utf8'))
      .resolves.toBe('user edit')
  })
})
