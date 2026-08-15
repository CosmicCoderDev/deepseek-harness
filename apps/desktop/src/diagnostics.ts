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
  await writeQueue
  const log = logFile === undefined ? '' : await readLogTail(logFile)
  const report = [
    'DeepSeek Harness Desktop Diagnostics',
    '====================================',
    ...Object.entries(metadata).map(([key, value]) => `${key}: ${redactDiagnosticText(value)}`),
    '',
    'Log tail (review before sharing):',
    '---------------------------------',
    redactDiagnosticText(log),
  ].join('\n')
  await writeFile(target, report, 'utf8')
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
