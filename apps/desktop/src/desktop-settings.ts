/** Versioned desktop preferences shared by the native settings surface and Host boot. */

import { mkdir, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { readProxySettings, validateProxyUrl, type ProxySettings } from './proxy-settings.ts'
import { desktopSubagentProviders } from './subagent-provider-registry.ts'

export type SubagentPermission = 'read-only' | 'project-development' | 'full-access'

export interface DesktopSettings {
  readonly version: 1
  readonly proxy: ProxySettings
  readonly subagentPermission: SubagentPermission
  readonly localModels: {
    readonly coding: string
    readonly vision: string
  }
}

export interface DesktopSettingsReadResult {
  readonly settings: DesktopSettings
  readonly recoveryWarning?: string
  readonly recoveredFile?: string
}

const SETTINGS_FILE = 'desktop-settings.json'

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  version: 1,
  proxy: { mode: 'system' },
  subagentPermission: 'read-only',
  localModels: { coding: 'qwen3-coder:30b', vision: 'qwen3-vl:8b' },
}

/** Read current settings and migrate the former proxy-only file when needed. */
export async function readDesktopSettings(dshHome: string): Promise<DesktopSettings> {
  return (await readDesktopSettingsWithRecovery(dshHome)).settings
}

/** Read settings, preserving an invalid file before installing safe defaults. */
export async function readDesktopSettingsWithRecovery(dshHome: string): Promise<DesktopSettingsReadResult> {
  const target = join(dshHome, SETTINGS_FILE)
  try {
    const parsed: unknown = JSON.parse(await readFile(target, 'utf8'))
    return { settings: validateDesktopSettings(parsed) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      await mkdir(dshHome, { recursive: true })
      const recoveredFile = join(dshHome, `desktop-settings.corrupt-${Date.now()}.json`)
      await rename(target, recoveredFile)
      await writeDesktopSettings(dshHome, DEFAULT_DESKTOP_SETTINGS)
      return {
        settings: DEFAULT_DESKTOP_SETTINGS,
        recoveryWarning: '桌面设置文件损坏或版本不受支持，已保留原文件并恢复为安全默认值。',
        recoveredFile,
      }
    }
    const proxy = await readProxySettings(dshHome)
    const migrated = { ...DEFAULT_DESKTOP_SETTINGS, proxy }
    await writeDesktopSettings(dshHome, migrated)
    return { settings: migrated }
  }
}

/** Validate and atomically replace the private desktop settings file. */
export async function writeDesktopSettings(dshHome: string, value: DesktopSettings): Promise<void> {
  const settings = validateDesktopSettings(value)
  const target = join(dshHome, SETTINGS_FILE)
  await writeFileAtomic(target, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
}

/** Project a user permission tier into fixed provider-native modes. */
export function applySubagentPermission(permission: SubagentPermission, environment: NodeJS.ProcessEnv = process.env): void {
  for (const provider of desktopSubagentProviders.list()) provider.applyPermission(permission, environment)
}

/** Reject settings values received across IPC or read from disk. */
export function validateDesktopSettings(value: unknown): DesktopSettings {
  if (typeof value !== 'object' || value === null) throw new Error('桌面设置格式无效')
  const candidate = value as { version?: unknown; proxy?: unknown; subagentPermission?: unknown; localModels?: unknown }
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
  let localModels = DEFAULT_DESKTOP_SETTINGS.localModels
  if (candidate.localModels !== undefined) {
    if (typeof candidate.localModels !== 'object' || candidate.localModels === null) throw new Error('本地模型设置格式无效')
    const models = candidate.localModels as { coding?: unknown; vision?: unknown }
    if (typeof models.coding !== 'string' || models.coding.trim().length === 0) throw new Error('本地代码模型不能为空')
    if (typeof models.vision !== 'string' || models.vision.trim().length === 0) throw new Error('本地视觉模型不能为空')
    localModels = { coding: models.coding.trim(), vision: models.vision.trim() }
  }
  return { version: 1, proxy, subagentPermission: permission, localModels }
}
