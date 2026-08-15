/**
 * Supervise the temporary loopback carrier used by the Electron proof of
 * concept. The production desktop transport remains Electron IPC; this
 * launcher deliberately keeps the bridge isolated so it can be removed.
 */

import { access } from 'node:fs/promises'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const READY_PREFIX = 'dsh web: '
const STARTUP_TIMEOUT_MS = 60_000

/** A ready backend and the process owned by this desktop invocation. */
export interface DesktopBackend {
  readonly url: URL
  readonly process: ChildProcessByStdio<null, Readable, Readable>
}

/** Accept only loopback HTTP URLs at the desktop trust boundary. */
export function parseLoopbackUrl(value: string): URL {
  const url = new URL(value)
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]'
  if (url.protocol !== 'http:' || !loopback || url.username !== '' || url.password !== '') {
    throw new Error(`desktop: backend URL must be loopback HTTP, got ${JSON.stringify(value)}`)
  }
  return url
}

/** Allow the desktop shell to hand only ordinary browser destinations to the OS. */
export function isSafeExternalUrl(value: string): boolean {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

/** Extract the canonical URL from one complete dsh readiness line. */
export function parseReadyLine(line: string): URL | undefined {
  if (!line.startsWith(READY_PREFIX)) return undefined
  const candidate = line.slice(READY_PREFIX.length).split(/\s/u, 1)[0]
  return candidate === undefined || candidate === '' ? undefined : parseLoopbackUrl(candidate)
}

/** Resolve the built CLI from both the TypeScript source and emitted main entry. */
function resolveCliEntry(): string {
  return fileURLToPath(new URL('../../cli/lib/bin.js', import.meta.url))
}

/**
 * Start `dsh web` on an OS-assigned loopback port and resolve only after its
 * readiness line. This development POC uses the checkout's Node runtime; a
 * distributable build must replace this seam with IPC or a bundled runtime.
 */
export async function startDesktopBackend(nodeExecutable: string): Promise<DesktopBackend> {
  const cliEntry = resolveCliEntry()
  await access(cliEntry).catch(() => {
    throw new Error('desktop: built dsh CLI is missing; run `pnpm run build` from the repository root')
  })

  const child = spawn(nodeExecutable, [cliEntry, 'web', '--host', '127.0.0.1', '--port', '0'], {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  return await new Promise<DesktopBackend>((resolve, reject) => {
    let stdout = ''
    let settled = false
    const finish = (error: Error | undefined, backend?: DesktopBackend): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.off('error', onError)
      child.off('exit', onExit)
      if (error !== undefined) reject(error)
      else if (backend !== undefined) resolve(backend)
    }
    const onError = (error: Error): void => { finish(error) }
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      finish(new Error(`desktop: dsh web exited before readiness (code=${String(code)}, signal=${String(signal)})`))
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish(new Error(`desktop: dsh web did not become ready within ${String(STARTUP_TIMEOUT_MS / 1000)} seconds`))
    }, STARTUP_TIMEOUT_MS)
    timer.unref()

    child.on('error', onError)
    child.on('exit', onExit)
    child.stderr.on('data', (chunk: Buffer) => { process.stderr.write(chunk) })
    child.stdout.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk)
      stdout += chunk.toString('utf8')
      for (;;) {
        const newline = stdout.indexOf('\n')
        if (newline < 0) break
        const line = stdout.slice(0, newline).trimEnd()
        stdout = stdout.slice(newline + 1)
        try {
          const url = parseReadyLine(line)
          if (url !== undefined) finish(undefined, { url, process: child })
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)))
        }
      }
    })
  })
}

/** Ask the owned backend to stop, escalating only after a bounded grace period. */
export function stopDesktopBackend(backend: DesktopBackend | undefined): void {
  if (backend === undefined || backend.process.exitCode !== null || backend.process.signalCode !== null) return
  backend.process.kill('SIGTERM')
  const force = setTimeout(() => {
    if (backend.process.exitCode === null && backend.process.signalCode === null) backend.process.kill('SIGKILL')
  }, 5_000)
  force.unref()
}
