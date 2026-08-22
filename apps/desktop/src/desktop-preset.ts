/** Install desktop-only preset templates and safely migrate known managed copies. */

import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

export const DESKTOP_PRESETS = [
  'local-only', 'auto-select', 'codex-claude', 'codex-direct', 'claude-direct', 'codex-claude-review',
] as const

export type DesktopPreset = typeof DESKTOP_PRESETS[number]

/**
 * Hashes of previously shipped, unmodified preset files eligible for a managed
 * upgrade. Unknown content is user-owned and is never overwritten.
 */
const LEGACY_MANAGED_HASHES: Readonly<Record<string, readonly string[]>> = {
  'local-only/agent.cordis.yml': ['8db61ebd3399741f9403ee43f0240526c2c3d8097b49c45e14cc98bbd09fb536'],
  'auto-select/agent.cordis.yml': ['7e52b3c760dd41f5570799643a703b0f4300444cb9d4ff20bcbe1f75e84fab5d'],
}

function digest(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

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
        const key = `${preset}/${name}`
        const legacy = LEGACY_MANAGED_HASHES[key]
        if (legacy === undefined) continue
        const [sourceContent, targetContent] = await Promise.all([
          readFile(join(source, name), 'utf8'),
          readFile(join(target, name), 'utf8'),
        ])
        if (sourceContent === targetContent || !legacy.includes(digest(targetContent))) continue
        await writeFileAtomic(join(target, name), sourceContent, { mode: 0o600, dirMode: 0o700 })
        created = true
      }
    }
  }
  return created
}
