/** Opt-in live smoke test for the two authenticated CLIs bundled in a packaged macOS app. */

import { execFile, spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const productName = 'DeepSeek Harness'
const appPath = resolve(process.argv[2] ?? `/Applications/${productName}.app`)
const resources = join(appPath, 'Contents', 'Resources', 'app.asar.unpacked')
const executable = join(appPath, 'Contents', 'MacOS', productName)
const codex = join(resources, 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
const claude = join(resources, 'node_modules', '@anthropic-ai', `claude-agent-sdk-darwin-${process.arch}`, 'claude')
const timeout = 120_000
const environment = await environmentWithSystemProxy(process.env)

const codexEnvironment = { ...environment, ELECTRON_RUN_AS_NODE: '1' }
const codexStatus = await run(executable, [codex, 'login', 'status'], codexEnvironment, 10_000)
if (!/logged in/iu.test(codexStatus)) {
  process.stdout.write('[desktop] SKIP Codex live smoke: not authenticated\n')
} else {
  const output = await run(executable, [
    codex, 'exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral',
    'Reply with exactly DSH_CODEX_OK and do not use tools.',
  ], codexEnvironment, timeout)
  assertSentinel('Codex', output, 'DSH_CODEX_OK')
}

const claudeStatus = await run(claude, ['auth', 'status'], environment, 10_000)
if (!/"loggedIn"\s*:\s*true/u.test(claudeStatus)) {
  process.stdout.write('[desktop] SKIP Claude Code live smoke: not authenticated\n')
} else {
  const output = await run(claude, [
    '-p', '--permission-mode', 'plan', '--tools', '', '--no-session-persistence',
    'Reply with exactly DSH_CLAUDE_OK and do not use tools.',
  ], environment, timeout)
  assertSentinel('Claude Code', output, 'DSH_CLAUDE_OK')
}

function assertSentinel(product, output, sentinel) {
  if (!output.includes(sentinel)) throw new Error(`${product} live smoke did not return ${sentinel}`)
  process.stdout.write(`[desktop] ${product} live smoke passed\n`)
}

async function run(command, args, env, timeoutMs) {
  return await new Promise((resolveOutput) => {
    const child = spawn(command, args, { cwd: process.cwd(), env, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { if (output.length < 2 * 1024 * 1024) output += chunk })
    child.stderr.on('data', chunk => { if (output.length < 2 * 1024 * 1024) output += chunk })
    child.stdin.end()
    const timer = setTimeout(() => { child.kill('SIGKILL') }, timeoutMs)
    child.once('error', error => { clearTimeout(timer); resolveOutput(`${output}${String(error)}`) })
    child.once('close', () => { clearTimeout(timer); resolveOutput(output) })
  })
}

async function environmentWithSystemProxy(source) {
  const env = { ...source }
  if (env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy) return env
  try {
    const result = await execute('/usr/sbin/scutil', ['--proxy'], { timeout: 5_000 })
    const value = result.stdout
    const httpsEnabled = /HTTPSEnable\s*:\s*1/u.test(value)
    const httpEnabled = /HTTPEnable\s*:\s*1/u.test(value)
    const host = value.match(new RegExp(`${httpsEnabled ? 'HTTPS' : 'HTTP'}Proxy\\s*:\\s*(\\S+)`, 'u'))?.[1]
    const port = value.match(new RegExp(`${httpsEnabled ? 'HTTPS' : 'HTTP'}Port\\s*:\\s*(\\d+)`, 'u'))?.[1]
    if ((httpsEnabled || httpEnabled) && host && port) {
      const proxy = `http://${host}:${port}`
      env.HTTP_PROXY = proxy
      env.HTTPS_PROXY = proxy
      env.http_proxy = proxy
      env.https_proxy = proxy
    }
    const socksEnabled = /SOCKSEnable\s*:\s*1/u.test(value)
    const socksHost = value.match(/SOCKSProxy\s*:\s*(\S+)/u)?.[1]
    const socksPort = value.match(/SOCKSPort\s*:\s*(\d+)/u)?.[1]
    if (socksEnabled && socksHost && socksPort) {
      env.ALL_PROXY = `socks5://${socksHost}:${socksPort}`
      env.all_proxy = env.ALL_PROXY
    }
  } catch {
    // Swallow scutil failures (missing binary, timeout, unparseable output): the
    // smoke script proceeds without a detected system proxy rather than failing.
  }
  env.NO_PROXY ??= '127.0.0.1,localhost,::1,.local'
  env.no_proxy ??= env.NO_PROXY
  return env
}
