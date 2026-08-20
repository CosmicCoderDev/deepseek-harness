/** Versioned desktop preferences shared by the native settings surface and Host boot. */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readProxySettings, validateProxyUrl, type ProxySettings } from './proxy-settings.ts'

export type SubagentPermission = 'read-only' | 'project-development' | 'full-access'

export interface DesktopSettings {
  readonly version: 1
  readonly proxy: ProxySettings
  readonly subagentPermission: SubagentPermission
}

const SETTINGS_FILE = 'desktop-settings.json'

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  version: 1,
  proxy: { mode: 'system' },
  subagentPermission: 'read-only',
}

/** Read current settings and migrate the former proxy-only file when needed. */
export async function readDesktopSettings(dshHome: string): Promise<DesktopSettings> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(dshHome, SETTINGS_FILE), 'utf8'))
    return validateDesktopSettings(parsed)
  } catch {
    const proxy = await readProxySettings(dshHome)
    const migrated = { ...DEFAULT_DESKTOP_SETTINGS, proxy }
    await writeDesktopSettings(dshHome, migrated)
    return migrated
  }
}

/** Validate and atomically replace the private desktop settings file. */
export async function writeDesktopSettings(dshHome: string, value: DesktopSettings): Promise<void> {
  const settings = validateDesktopSettings(value)
  await mkdir(dshHome, { recursive: true })
  const target = join(dshHome, SETTINGS_FILE)
  const temporary = join(dshHome, `.desktop-settings-${randomUUID()}.tmp`)
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, target)
}

/** Project a user permission tier into fixed provider-native modes. */
export function applySubagentPermission(permission: SubagentPermission, environment: NodeJS.ProcessEnv = process.env): void {
  const mapping = permission === 'read-only'
    ? ['never', 'plan']
    : permission === 'project-development'
      ? ['approve-for-me', 'acceptEdits']
      : ['dangerously-bypass-approvals-and-sandbox', 'bypassPermissions']
  environment.DSH_CODEX_PERMISSION_MODE = mapping[0]
  environment.DSH_CLAUDE_PERMISSION_MODE = mapping[1]
}

/** Reject settings values received across IPC or read from disk. */
export function validateDesktopSettings(value: unknown): DesktopSettings {
  if (typeof value !== 'object' || value === null) throw new Error('桌面设置格式无效')
  const candidate = value as { version?: unknown; proxy?: unknown; subagentPermission?: unknown }
  if (candidate.version !== 1) throw new Error('不支持的桌面设置版本')
  const permission = candidate.subagentPermission
  if (permission !== 'read-only' && permission !== 'project-development' && permission !== 'full-access') {
    throw new Error('子代理权限模式无效')
  }
  if (typeof candidate.proxy !== 'object' || candidate.proxy === null) throw new Error('代理设置格式无效')
  const proxyValue = candidate.proxy as { mode?: unknown; url?: unknown }
  let proxy: ProxySettings
  if (proxyValue.mode === 'system' || proxyValue.mode === 'direct') proxy = { mode: proxyValue.mode }
  else if (proxyValue.mode === 'manual' && typeof proxyValue.url === 'string') {
    proxy = { mode: 'manual', url: validateProxyUrl(proxyValue.url) }
  } else throw new Error('代理模式无效')
  return { version: 1, proxy, subagentPermission: permission }
}
