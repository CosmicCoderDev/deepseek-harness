/** Fixed, user-visible login launchers for bundled product CLIs on macOS. */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { desktopSubagentProviders, type DesktopSubagentProviderId } from './subagent-provider-registry.ts'

const execute = promisify(execFile)

export type SubagentProduct = DesktopSubagentProviderId

export function subagentLoginCommand(product: SubagentProduct, appPath: string, executablePath: string): string {
  return desktopSubagentProviders.get(product).loginCommand(appPath, executablePath)
}

export async function openSubagentLogin(product: SubagentProduct, appPath: string, executablePath: string): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('当前桌面登录引导仅支持 macOS')
  const command = subagentLoginCommand(product, appPath, executablePath)
  await execute('/usr/bin/osascript', [
    '-e', 'tell application "Terminal" to activate',
    '-e', `tell application "Terminal" to do script "${appleScriptString(command)}"`,
  ])
}

function appleScriptString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}
