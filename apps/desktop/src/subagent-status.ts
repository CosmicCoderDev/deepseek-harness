/** Desktop diagnostics projected from the bundled provider registry. */

import {
  desktopSubagentProviders,
  parseClaudeAuth,
  parseCodexAuth,
  type ProductStatus,
} from './subagent-provider-registry.ts'

export type { ProductStatus } from './subagent-provider-registry.ts'
export { parseClaudeAuth, parseCodexAuth }

export interface SubagentStatus {
  readonly codex: ProductStatus
  readonly claude: ProductStatus
  readonly proxy: string
}

export async function inspectSubagents(appPath: string): Promise<SubagentStatus> {
  const statuses = await Promise.all(desktopSubagentProviders.list().map(
    async provider => [provider.id, await provider.inspect(appPath)] as const,
  ))
  const byId = Object.fromEntries(statuses) as Record<'codex' | 'claude', ProductStatus>
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? '未启用'
  return { codex: byId.codex, claude: byId.claude, proxy }
}

export function formatSubagentStatus(status: SubagentStatus): string {
  const values = { codex: status.codex, claude: status.claude }
  const products = desktopSubagentProviders.list().map((provider) => {
    const value = values[provider.id]
    return `${provider.displayName}: ${value.installed ? '已内置' : '未安装'} · ${value.authenticated ? '已登录' : '未登录'}\n${value.detail}`
  })
  return `${products.join('\n\n')}\n\n系统代理: ${status.proxy}`
}
