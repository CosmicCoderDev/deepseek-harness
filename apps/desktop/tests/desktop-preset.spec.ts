import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensureDesktopPreset } from '../src/desktop-preset.ts'

describe('desktop preset installer', () => {
  it('installs once and never overwrites a user-edited preset', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-preset-'))
    const home = join(root, 'home')
    for (const preset of ['codex-claude', 'codex-direct', 'claude-direct']) {
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
  })
})
