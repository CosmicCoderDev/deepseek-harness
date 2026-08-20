/** Persistent desktop proxy preferences and environment projection. */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import {
  LOCAL_PROXY_BYPASS,
  readSystemProxy,
  replaceProxyEnvironment,
  type ProxyEnvironment,
} from './system-proxy.ts'

export type ProxyMode = 'system' | 'manual' | 'direct'

export interface ProxySettings {
  readonly mode: ProxyMode
  readonly url?: string
}

export interface ProxySnapshot {
  readonly settings: ProxySettings
  readonly environment: ProxyEnvironment
}

const SETTINGS_FILE = 'desktop-proxy.json'

/** Read validated proxy preferences, defaulting to the system proxy. */
export async function readProxySettings(dshHome: string): Promise<ProxySettings> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(dshHome, SETTINGS_FILE), 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || !('mode' in parsed)) return { mode: 'system' }
    const mode = (parsed as { mode?: unknown }).mode
    const url = (parsed as { url?: unknown }).url
    if (mode === 'direct' || mode === 'system') return { mode }
    if (mode === 'manual' && typeof url === 'string') return { mode, url: validateProxyUrl(url) }
  } catch {
    // Missing or invalid user settings fall back to the safe product default.
  }
  return { mode: 'system' }
}

/** Validate and persist desktop proxy preferences. */
export async function writeProxySettings(dshHome: string, settings: ProxySettings): Promise<void> {
  const normalized = settings.mode === 'manual'
    ? { mode: settings.mode, url: validateProxyUrl(settings.url ?? '') }
    : { mode: settings.mode }
  await writeFileAtomic(join(dshHome, SETTINGS_FILE), `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 })
}

/** Resolve and apply the selected proxy mode to CLI subprocess variables. */
export function applyProxySettings(
  settings: ProxySettings,
  environment: NodeJS.ProcessEnv = process.env,
): ProxySnapshot {
  const selected = settings.mode === 'system'
    ? readSystemProxy()
    : settings.mode === 'manual'
      ? manualEnvironment(validateProxyUrl(settings.url ?? ''))
      : {}
  return { settings, environment: replaceProxyEnvironment(selected, environment) }
}

/** Render a credential-free summary for settings and diagnostics. */
export function formatProxySnapshot(snapshot: ProxySnapshot): string {
  const mode = snapshot.settings.mode === 'system'
    ? '自动读取系统代理'
    : snapshot.settings.mode === 'manual' ? '手动代理' : '不使用代理'
  const address = snapshot.environment.HTTPS_PROXY
    ?? snapshot.environment.HTTP_PROXY
    ?? snapshot.environment.ALL_PROXY
    ?? '直连'
  return `模式: ${mode}\n当前地址: ${hideProxyCredentials(address)}\n本地绕过: ${LOCAL_PROXY_BYPASS}`
}

/** Return a safe proxy address or reject unsupported input. */
export function validateProxyUrl(value: string): string {
  const trimmed = value.trim()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('代理地址格式无效，请填写 http://、https:// 或 socks5:// 地址')
  }
  if (!['http:', 'https:', 'socks5:'].includes(parsed.protocol) || parsed.hostname === '' || parsed.port === '') {
    throw new Error('代理地址必须包含协议、主机和端口')
  }
  return parsed.toString().replace(/\/$/u, '')
}

function manualEnvironment(url: string): ProxyEnvironment {
  return url.startsWith('socks5:')
    ? { ALL_PROXY: url, NO_PROXY: LOCAL_PROXY_BYPASS }
    : { HTTP_PROXY: url, HTTPS_PROXY: url, NO_PROXY: LOCAL_PROXY_BYPASS }
}

function hideProxyCredentials(value: string): string {
  try {
    const parsed = new URL(value)
    if (parsed.username !== '' || parsed.password !== '') {
      parsed.username = '[REDACTED]'
      parsed.password = '[REDACTED]'
    }
    return parsed.toString().replace(/\/$/u, '')
  } catch {
    return value
  }
}
