/** Desktop diagnostics for bundled Codex and Claude Code products. */

import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)

export interface ProductStatus {
  readonly installed: boolean
  readonly authenticated: boolean
  readonly detail: string
}

export interface SubagentStatus {
  readonly codex: ProductStatus
  readonly claude: ProductStatus
  readonly proxy: string
}

export function parseClaudeAuth(output: string): ProductStatus {
  try {
    const value = JSON.parse(output) as { loggedIn?: unknown; authMethod?: unknown; subscriptionType?: unknown }
    const authenticated = value.loggedIn === true
    const detail = authenticated
      ? [value.authMethod, value.subscriptionType].filter(item => typeof item === 'string').join(' · ') || '已登录'
      : '未登录'
    return { installed: true, authenticated, detail }
  } catch {
    return { installed: true, authenticated: false, detail: '认证状态无法解析' }
  }
}

export function parseCodexAuth(output: string): ProductStatus {
  const authenticated = /logged in/i.test(output)
  return { installed: true, authenticated, detail: authenticated ? output.trim() : '未登录' }
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

export async function inspectSubagents(appPath: string): Promise<SubagentStatus> {
  const modules = join(appPath, 'node_modules')
  const codexWrapper = join(modules, '@openai/codex/bin/codex.js')
  const claudeBinary = join(modules, '@anthropic-ai/claude-agent-sdk-darwin-arm64/claude')
  const codex: ProductStatus = await exists(codexWrapper)
    ? await execute(process.execPath, [codexWrapper, 'login', 'status'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 10_000,
    }).then(result => parseCodexAuth(`${result.stdout}${result.stderr}`), error => ({
      installed: true, authenticated: false, detail: error instanceof Error ? error.message : String(error),
    }))
    : { installed: false, authenticated: false, detail: '未内置' }
  const claude: ProductStatus = await exists(claudeBinary)
    ? await execute(claudeBinary, ['auth', 'status'], { env: process.env, timeout: 10_000 })
      .then(result => parseClaudeAuth(result.stdout), error => ({
        installed: true, authenticated: false, detail: error instanceof Error ? error.message : String(error),
      }))
    : { installed: false, authenticated: false, detail: '未内置' }
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? '未启用'
  return { codex, claude, proxy }
}

export function formatSubagentStatus(status: SubagentStatus): string {
  const line = (name: string, value: ProductStatus): string =>
    `${name}: ${value.installed ? '已内置' : '未安装'} · ${value.authenticated ? '已登录' : '未登录'}\n${value.detail}`
  return `${line('Codex', status.codex)}\n\n${line('Claude Code', status.claude)}\n\n系统代理: ${status.proxy}`
}
