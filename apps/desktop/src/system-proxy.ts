/** Import the active macOS proxy into the desktop process environment. */

import { execFileSync } from 'node:child_process'

export interface ProxyEnvironment {
  readonly HTTP_PROXY?: string
  readonly HTTPS_PROXY?: string
  readonly ALL_PROXY?: string
  readonly NO_PROXY?: string
}

function value(output: string, key: string): string | undefined {
  const match = output.match(new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, 'm'))
  return match?.[1]
}

function endpoint(output: string, kind: 'HTTP' | 'HTTPS' | 'SOCKS'): string | undefined {
  if (value(output, `${kind}Enable`) !== '1') return undefined
  const host = value(output, `${kind}Proxy`)
  const port = value(output, `${kind}Port`)
  if (host === undefined || port === undefined || !/^\d+$/.test(port)) return undefined
  return `${kind === 'SOCKS' ? 'socks5' : 'http'}://${host}:${port}`
}

/** Convert `scutil --proxy` output into conventional CLI proxy variables. */
export function parseMacosProxy(output: string): ProxyEnvironment {
  const http = endpoint(output, 'HTTP')
  const https = endpoint(output, 'HTTPS') ?? http
  const socks = endpoint(output, 'SOCKS')
  if (http === undefined && https === undefined && socks === undefined) return {}
  return {
    ...(http === undefined ? {} : { HTTP_PROXY: http }),
    ...(https === undefined ? {} : { HTTPS_PROXY: https }),
    ...(socks === undefined ? {} : { ALL_PROXY: socks }),
    NO_PROXY: '127.0.0.1,localhost,::1,*.local',
  }
}

/** Apply the active macOS proxy without replacing explicit launch-time values. */
export function applySystemProxy(environment: NodeJS.ProcessEnv = process.env): ProxyEnvironment {
  if (process.platform !== 'darwin') return {}
  let detected: ProxyEnvironment
  try {
    detected = parseMacosProxy(execFileSync('/usr/sbin/scutil', ['--proxy'], {
      encoding: 'utf8',
      timeout: 2_000,
    }))
  } catch {
    return {}
  }
  const applied: Record<string, string> = {}
  for (const [upper, detectedValue] of Object.entries(detected)) {
    if (detectedValue === undefined) continue
    const lower = upper.toLowerCase()
    const selected = environment[upper] ?? environment[lower] ?? detectedValue
    environment[upper] = selected
    environment[lower] = selected
    applied[upper] = selected
  }
  return applied
}
