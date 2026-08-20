/** Fixed, user-visible login launchers for bundled product CLIs on macOS. */

import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)

export type SubagentProduct = 'codex' | 'claude'

export function subagentLoginCommand(product: SubagentProduct, appPath: string, executablePath: string): string {
  const modules = join(appPath, 'node_modules')
  if (product === 'codex') {
    const wrapper = join(modules, '@openai/codex/bin/codex.js')
    return `env ELECTRON_RUN_AS_NODE=1 ${shellQuote(executablePath)} ${shellQuote(wrapper)} login`
  }
  const binary = join(modules, '@anthropic-ai/claude-agent-sdk-darwin-arm64/claude')
  return `${shellQuote(binary)} auth login`
}

export async function openSubagentLogin(product: SubagentProduct, appPath: string, executablePath: string): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('当前桌面登录引导仅支持 macOS')
  const command = subagentLoginCommand(product, appPath, executablePath)
  await execute('/usr/bin/osascript', [
    '-e', 'tell application "Terminal" to activate',
    '-e', `tell application "Terminal" to do script "${appleScriptString(command)}"`,
  ])
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function appleScriptString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}
