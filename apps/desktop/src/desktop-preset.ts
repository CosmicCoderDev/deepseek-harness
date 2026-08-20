/** Install desktop-only preset templates without overwriting user files. */

import { constants } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export const DESKTOP_PRESETS = [
  'local-only', 'auto-select', 'codex-claude', 'codex-direct', 'claude-direct', 'codex-claude-review',
] as const

export async function ensureDesktopPreset(configRoot: string, dshHome: string): Promise<boolean> {
  let created = false
  for (const preset of DESKTOP_PRESETS) {
    const source = join(configRoot, 'agent-presets', preset)
    const target = join(dshHome, '.agent-presets', preset)
    await mkdir(target, { recursive: true, mode: 0o700 })
    for (const name of ['agent.cordis.yml', 'preset.yml']) {
      try {
        await copyFile(join(source, name), join(target, name), constants.COPYFILE_EXCL)
        created = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
  }
  return created
}
