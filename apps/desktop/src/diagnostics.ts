/** Bounded, redacted desktop diagnostics suitable for local support export. */

import { appendFile, mkdir, open, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const MAX_LOG_READ_BYTES = 256 * 1024
const MAX_ENTRY_CHARS = 16 * 1024
let logFile: string | undefined
let writeQueue: Promise<void> = Promise.resolve()

/** Path to the current desktop log after diagnostics initialization. */
export function desktopLogPath(): string | undefined {
  return logFile
}

/** Create the log directory and begin a new bounded diagnostic session. */
export async function initializeDesktopDiagnostics(logsDirectory: string): Promise<string> {
  await mkdir(logsDirectory, { recursive: true })
  logFile = join(logsDirectory, 'desktop.log')
  await appendFile(logFile, `\n${formatEntry('info', 'desktop session started')}\n`, 'utf8')
  return logFile
}

/** Redact common credential shapes before data reaches disk or an export. */
export function redactDiagnosticText(value: string): string {
  return value
    .replace(/\b(Bearer)\s+[A-Z0-9._~+-]+/giu, '$1 [REDACTED]')
    .replace(/\b(api[_-]?key|token|authorization|password)\b(\s*[=:]\s*)([^\s,;]+)/giu, '$1$2[REDACTED]')
    .replace(/([?&](?:code|state|code_challenge|code_verifier)=)[^&\s]+/giu, '$1[REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '[REDACTED_EMAIL]')
}

export interface FriendlyDesktopError {
  readonly title: string
  readonly detail: string
  readonly action: string
}

/** Translate known provider failures into user-facing causes and actions. */
export function explainDesktopError(product: 'Codex' | 'Claude Code' | 'Network', error: unknown): FriendlyDesktopError {
  const raw = redactDiagnosticText(renderDetail(error))
  const lower = raw.toLowerCase()
  if (lower.includes('electron_run_as_node') || lower.includes('node mode')) {
    return { title: `${product} 启动失败`, detail: 'Electron 未以 Node 模式启动命令包装器。', action: '请更新或重新安装桌面客户端。' }
  }
  if (lower.includes('not logged in') || lower.includes('unauthorized') || lower.includes('authentication') || lower.includes('auth login')) {
    return { title: `${product} 登录失效`, detail: '当前授权不存在或已经过期。', action: '请重新登录后再次测试连接。' }
  }
  if (lower.includes('timed out') || lower.includes('timeout')) {
    return { title: `${product} 连接超时`, detail: '服务在限定时间内没有响应。', action: '请检查代理和网络连接后重试。' }
  }
  if (lower.includes('econnrefused') || lower.includes('proxy') || lower.includes('network') || lower.includes('fetch failed')) {
    return { title: `${product} 网络连接失败`, detail: '无法通过当前网络或代理连接服务。', action: '请打开代理设置并运行连通性测试。' }
  }
  if (lower.includes('module_not_found') || lower.includes('cannot find package') || lower.includes('enoent')) {
    return { title: `${product} 组件缺失`, detail: '安装包缺少运行所需的组件或可执行文件。', action: '请重新安装完整桌面包。' }
  }
  const summary = raw.replace(/\s+/gu, ' ').slice(0, 320)
  return { title: `${product} 运行失败`, detail: summary || '发生未知错误。', action: '请复制诊断信息并提交给开发者。' }
}

/** Record one message without blocking the Electron event loop. */
export function recordDesktopDiagnostic(
  level: 'info' | 'warn' | 'error',
  message: string,
  detail?: unknown,
): void {
  const renderedDetail = detail === undefined ? '' : `\n${renderDetail(detail)}`
  const entry = formatEntry(level, `${message}${renderedDetail}`)
  const consoleMethod = level === 'info' ? console.log : level === 'warn' ? console.warn : console.error
  consoleMethod(entry)
  const path = logFile
  if (path === undefined) return
  writeQueue = writeQueue
    .then(async () => { await appendFile(path, `${entry}\n`, 'utf8') })
    .catch((error: unknown) => { console.error('[desktop] failed to write diagnostic log', error) })
}

/** Build and save a support report without environment variables or credentials. */
export async function exportDesktopDiagnostics(
  target: string,
  metadata: Readonly<Record<string, string>>,
): Promise<void> {
  await writeFile(target, await createDesktopDiagnostics(metadata), 'utf8')
}

/** Build a bounded support report for file export or clipboard copy. */
export async function createDesktopDiagnostics(metadata: Readonly<Record<string, string>>): Promise<string> {
  await writeQueue
  const log = logFile === undefined ? '' : await readLogTail(logFile)
  return [
    'DeepSeek Harness Desktop Diagnostics',
    '====================================',
    ...Object.entries(metadata).map(([key, value]) => `${key}: ${redactDiagnosticText(value)}`),
    '',
    'Log tail (review before sharing):',
    '---------------------------------',
    redactDiagnosticText(log),
  ].join('\n')
}

function renderDetail(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function formatEntry(level: string, message: string): string {
  const safe = redactDiagnosticText(message).slice(0, MAX_ENTRY_CHARS)
  return `${new Date().toISOString()} [${level.toUpperCase()}] ${safe}`
}

async function readLogTail(path: string): Promise<string> {
  const fileSize = (await stat(path)).size
  const start = Math.max(0, fileSize - MAX_LOG_READ_BYTES)
  const length = fileSize - start
  const content = Buffer.alloc(length)
  const handle = await open(path, 'r')
  try {
    await handle.read(content, 0, length, start)
  } finally {
    await handle.close()
  }
  return content.toString('utf8')
}
