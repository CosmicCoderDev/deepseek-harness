/** Versioned, credential-free project policy storage for the desktop application. */

import { mkdir, readFile, rename } from 'node:fs/promises'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { DESKTOP_PRESETS, type DesktopPreset } from './desktop-preset.ts'
import type { SubagentPermission } from './desktop-settings.ts'

export type ProjectNetworkPolicy = 'inherit' | 'allow' | 'deny'
export type ProjectProxyPolicy =
  | { readonly mode: 'inherit' | 'system' | 'direct' }
  | { readonly mode: 'manual'; readonly url: string }

export interface DesktopProjectPolicy {
  readonly version: 1
  readonly projectRoot: string
  readonly defaultExecutionMode: DesktopPreset
  readonly defaultProvider?: string
  readonly defaultModel?: string
  readonly permissionCap: SubagentPermission
  readonly network: ProjectNetworkPolicy
  readonly proxy: ProjectProxyPolicy
  readonly crossReview: boolean
  readonly readRoots: readonly string[]
  readonly writeRoots: readonly string[]
}

export interface ProjectPolicyReadResult {
  readonly policies: ReadonlyMap<string, DesktopProjectPolicy>
  readonly recoveryWarning?: string
  readonly recoveredFile?: string
}

/** Resolve the preset that may be applied at the next blank-session boundary. */
export function projectExecutionMode(policy: DesktopProjectPolicy): DesktopPreset {
  if (policy.network === 'deny') return 'local-only'
  if (policy.crossReview) return 'codex-claude-review'
  return policy.defaultExecutionMode
}

/** Resolve the most specific configured permission cap containing a task cwd. */
export function resolveProjectPermissionCap(
  policies: ReadonlyMap<string, DesktopProjectPolicy>,
  cwd: string,
): SubagentPermission | undefined {
  return resolveProjectPolicy(policies, cwd)?.permissionCap
}

/** Resolve the most specific configured policy containing a task cwd. */
export function resolveProjectPolicy(
  policies: ReadonlyMap<string, DesktopProjectPolicy>,
  cwd: string,
): DesktopProjectPolicy | undefined {
  const normalizedCwd = normalizeRoot(cwd)
  let selected: DesktopProjectPolicy | undefined
  for (const policy of policies.values()) {
    if (!isWithin(policy.projectRoot, normalizedCwd)) continue
    if (selected === undefined || policy.projectRoot.length > selected.projectRoot.length) selected = policy
  }
  return selected
}

const POLICY_FILE = 'desktop-project-policies.json'

/** Create the least-authority editable draft for a project without enabling it. */
export function defaultProjectPolicy(projectRoot: string): DesktopProjectPolicy {
  const root = normalizeRoot(projectRoot)
  return {
    version: 1,
    projectRoot: root,
    defaultExecutionMode: 'local-only',
    permissionCap: 'read-only',
    network: 'deny',
    proxy: { mode: 'inherit' },
    crossReview: false,
    readRoots: [root],
    writeRoots: [],
  }
}

/** Read all configured policies; invalid files are preserved and replaced by an empty store. */
export async function readProjectPolicies(dshHome: string): Promise<ProjectPolicyReadResult> {
  const target = join(dshHome, POLICY_FILE)
  try {
    const parsed: unknown = JSON.parse(await readFile(target, 'utf8'))
    return { policies: validatePolicyFile(parsed) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { policies: new Map() }
    await mkdir(dshHome, { recursive: true })
    const recoveredFile = join(dshHome, `desktop-project-policies.corrupt-${Date.now()}.json`)
    await rename(target, recoveredFile)
    await writeProjectPolicies(dshHome, new Map())
    return {
      policies: new Map(),
      recoveryWarning: '项目策略文件损坏或版本不受支持，已保留原文件并停用全部项目覆盖。',
      recoveredFile,
    }
  }
}

/** Atomically persist validated project policies in the private desktop home. */
export async function writeProjectPolicies(
  dshHome: string,
  policies: ReadonlyMap<string, DesktopProjectPolicy>,
): Promise<void> {
  const projects: Record<string, DesktopProjectPolicy> = {}
  for (const [root, policy] of policies) {
    const normalized = validateProjectPolicy(policy)
    if (normalizeRoot(root) !== normalized.projectRoot) throw new Error('项目策略键与项目根目录不一致')
    projects[normalized.projectRoot] = normalized
  }
  const target = join(dshHome, POLICY_FILE)
  await writeFileAtomic(target, `${JSON.stringify({ version: 1, projects }, null, 2)}\n`, { mode: 0o600 })
}

/** Validate one renderer- or disk-supplied policy and return its canonical form. */
export function validateProjectPolicy(value: unknown): DesktopProjectPolicy {
  if (typeof value !== 'object' || value === null) throw new Error('项目策略格式无效')
  const candidate = value as Record<string, unknown>
  if (candidate.version !== 1) throw new Error('不支持的项目策略版本')
  const projectRoot = normalizeRoot(candidate.projectRoot)
  const defaultExecutionMode = candidate.defaultExecutionMode
  if (typeof defaultExecutionMode !== 'string' || !isDesktopPreset(defaultExecutionMode)) {
    throw new Error('项目默认执行方式无效')
  }
  const permissionCap = validatePermission(candidate.permissionCap)
  const network = candidate.network
  if (network !== 'inherit' && network !== 'allow' && network !== 'deny') throw new Error('项目联网策略无效')
  const proxy = validateProjectProxy(candidate.proxy)
  if (typeof candidate.crossReview !== 'boolean') throw new Error('项目交叉审核设置无效')
  const readRoots = validateRoots(candidate.readRoots, '读取')
  const writeRoots = validateRoots(candidate.writeRoots, '写入')
  if (!readRoots.includes(projectRoot)) throw new Error('项目读取边界必须包含项目根目录')
  for (const writeRoot of writeRoots) {
    if (!readRoots.some(readRoot => isWithin(readRoot, writeRoot))) throw new Error('项目写入边界必须位于读取边界内')
  }
  const defaultProvider = optionalIdentifier(candidate.defaultProvider, 'provider')
  const defaultModel = optionalIdentifier(candidate.defaultModel, '模型')
  return {
    version: 1,
    projectRoot,
    defaultExecutionMode,
    ...(defaultProvider === undefined ? {} : { defaultProvider }),
    ...(defaultModel === undefined ? {} : { defaultModel }),
    permissionCap,
    network,
    proxy,
    crossReview: candidate.crossReview,
    readRoots,
    writeRoots,
  }
}

function validatePolicyFile(value: unknown): ReadonlyMap<string, DesktopProjectPolicy> {
  if (typeof value !== 'object' || value === null) throw new Error('项目策略文件格式无效')
  const candidate = value as { version?: unknown; projects?: unknown }
  if (candidate.version !== 1 || typeof candidate.projects !== 'object' || candidate.projects === null) {
    throw new Error('不支持的项目策略文件版本')
  }
  const result = new Map<string, DesktopProjectPolicy>()
  for (const [root, raw] of Object.entries(candidate.projects)) {
    const policy = validateProjectPolicy(raw)
    if (normalizeRoot(root) !== policy.projectRoot) throw new Error('项目策略键与项目根目录不一致')
    result.set(policy.projectRoot, policy)
  }
  return result
}

function normalizeRoot(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || !isAbsolute(value)) throw new Error('项目目录必须是绝对路径')
  return resolve(value)
}

function validateRoots(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`项目${label}边界格式无效`)
  return [...new Set(value.map(normalizeRoot))]
}

function validatePermission(value: unknown): SubagentPermission {
  if (value !== 'read-only' && value !== 'project-development' && value !== 'full-access') {
    throw new Error('项目权限上限无效')
  }
  return value
}

function validateProjectProxy(value: unknown): ProjectProxyPolicy {
  if (typeof value !== 'object' || value === null) throw new Error('项目代理策略格式无效')
  const proxy = value as { mode?: unknown; url?: unknown }
  if (proxy.mode === 'inherit' || proxy.mode === 'system' || proxy.mode === 'direct') return { mode: proxy.mode }
  if (proxy.mode !== 'manual' || typeof proxy.url !== 'string') throw new Error('项目代理策略无效')
  let url: URL
  try {
    url = new URL(proxy.url)
  } catch {
    throw new Error('项目代理地址格式无效')
  }
  if (!['http:', 'https:', 'socks5:'].includes(url.protocol) || url.hostname === '' || url.port === '') {
    throw new Error('项目代理地址必须包含协议、主机和端口')
  }
  if (url.username !== '' || url.password !== '') throw new Error('项目策略不能保存代理凭据')
  return { mode: 'manual', url: url.toString().replace(/\/$/u, '') }
}

function optionalIdentifier(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '' || value.length > 200 || /[\r\n]/u.test(value)) {
    throw new Error(`项目默认${label}无效`)
  }
  return value.trim()
}

function isDesktopPreset(value: string): value is DesktopPreset {
  return (DESKTOP_PRESETS as readonly string[]).includes(value)
}

function isWithin(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}${sep}`)
}
