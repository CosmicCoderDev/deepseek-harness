/** Closed desktop registry for bundled cloud subagent products. */

import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { explainDesktopError } from './diagnostics.ts'
import type { SubagentPermission } from './desktop-settings.ts'

const execute = promisify(execFile)

export type DesktopSubagentProviderId = 'codex' | 'claude'
export type DesktopProviderCapability = 'read-only' | 'workspace-write' | 'full-access' | 'login' | 'connectivity-test'

export interface ProductStatus {
  readonly installed: boolean
  readonly authenticated: boolean
  readonly detail: string
}

export interface DesktopSubagentProvider {
  readonly id: DesktopSubagentProviderId
  readonly displayName: string
  readonly capabilities: readonly DesktopProviderCapability[]
  readonly supportedPlatforms: readonly NodeJS.Platform[]
  readonly connectivityUrl: string
  inspect(appPath: string): Promise<ProductStatus>
  loginCommand(appPath: string, executablePath: string): string
  permissionMode(tier: SubagentPermission): string
  applyPermission(tier: SubagentPermission, environment: NodeJS.ProcessEnv): void
}

const ALLOWED_CAPABILITIES = new Set<DesktopProviderCapability>([
  'read-only', 'workspace-write', 'full-access', 'login', 'connectivity-test',
])

export class DesktopSubagentProviderRegistry {
  private readonly providers = new Map<DesktopSubagentProviderId, DesktopSubagentProvider>()

  register(provider: DesktopSubagentProvider): void {
    if (this.providers.has(provider.id)) throw new Error(`重复的桌面 Provider ID: ${provider.id}`)
    for (const capability of provider.capabilities) {
      if (!ALLOWED_CAPABILITIES.has(capability)) throw new Error(`未知的桌面 Provider 能力: ${String(capability)}`)
    }
    this.providers.set(provider.id, provider)
  }

  get(id: DesktopSubagentProviderId): DesktopSubagentProvider {
    const provider = this.providers.get(id)
    if (provider === undefined) throw new Error(`未知的桌面 Provider: ${id}`)
    return provider
  }

  list(): readonly DesktopSubagentProvider[] {
    return [...this.providers.values()]
  }
}

function parseClaudeAuth(output: string): ProductStatus {
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

function parseCodexAuth(output: string): ProductStatus {
  const authenticated = /logged in/i.test(output)
  return { installed: true, authenticated, detail: authenticated ? output.trim() : '未登录' }
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

function friendlyDetail(product: 'Codex' | 'Claude Code', error: unknown): string {
  const explained = explainDesktopError(product, error)
  return `${explained.detail} ${explained.action}`
}

const commonCapabilities = [
  'read-only', 'workspace-write', 'full-access', 'login', 'connectivity-test',
] as const

const codex: DesktopSubagentProvider = {
  id: 'codex',
  displayName: 'Codex',
  capabilities: commonCapabilities,
  supportedPlatforms: ['darwin'],
  connectivityUrl: 'https://api.openai.com/v1/models',
  async inspect(appPath) {
    const wrapper = join(appPath, 'node_modules', '@openai/codex/bin/codex.js')
    if (!await exists(wrapper)) return { installed: false, authenticated: false, detail: '未内置' }
    return await execute(process.execPath, [wrapper, 'login', 'status'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 10_000,
    }).then(result => parseCodexAuth(`${result.stdout}${result.stderr}`), error => ({
      installed: true, authenticated: false, detail: friendlyDetail('Codex', error),
    }))
  },
  loginCommand(appPath, executablePath) {
    const wrapper = join(appPath, 'node_modules', '@openai/codex/bin/codex.js')
    return `env ELECTRON_RUN_AS_NODE=1 ${shellQuote(executablePath)} ${shellQuote(wrapper)} login`
  },
  permissionMode(tier) {
    return tier === 'read-only' ? 'never' : tier === 'project-development' ? 'approve-for-me' : 'dangerously-bypass-approvals-and-sandbox'
  },
  applyPermission(tier, environment) {
    environment.DSH_CODEX_PERMISSION_MODE = this.permissionMode(tier)
  },
}

const claude: DesktopSubagentProvider = {
  id: 'claude',
  displayName: 'Claude Code',
  capabilities: commonCapabilities,
  supportedPlatforms: ['darwin'],
  connectivityUrl: 'https://api.anthropic.com/v1/models',
  async inspect(appPath) {
    const binary = join(appPath, 'node_modules', '@anthropic-ai/claude-agent-sdk-darwin-arm64/claude')
    if (!await exists(binary)) return { installed: false, authenticated: false, detail: '未内置' }
    return await execute(binary, ['auth', 'status'], { env: process.env, timeout: 10_000 })
      .then(result => parseClaudeAuth(result.stdout), error => ({
        installed: true, authenticated: false, detail: friendlyDetail('Claude Code', error),
      }))
  },
  loginCommand(appPath) {
    const binary = join(appPath, 'node_modules', '@anthropic-ai/claude-agent-sdk-darwin-arm64/claude')
    return `${shellQuote(binary)} auth login`
  },
  permissionMode(tier) {
    return tier === 'read-only' ? 'plan' : tier === 'project-development' ? 'acceptEdits' : 'bypassPermissions'
  },
  applyPermission(tier, environment) {
    environment.DSH_CLAUDE_PERMISSION_MODE = this.permissionMode(tier)
  },
}

export const desktopSubagentProviders = new DesktopSubagentProviderRegistry()
desktopSubagentProviders.register(codex)
desktopSubagentProviders.register(claude)

export { parseClaudeAuth, parseCodexAuth }

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}
