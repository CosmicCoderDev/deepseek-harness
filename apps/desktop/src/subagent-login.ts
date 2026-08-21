/** Fixed, user-visible login launchers for bundled product CLIs on macOS. */

import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { desktopSubagentProviders, type DesktopSubagentProviderId } from './subagent-provider-registry.ts'

const execute = promisify(execFile)

export type SubagentProduct = DesktopSubagentProviderId

export function subagentLoginCommand(product: SubagentProduct, appPath: string, executablePath: string): string {
  return desktopSubagentProviders.get(product).loginCommand(appPath, executablePath)
}

export async function openSubagentLogin(product: SubagentProduct, appPath: string, executablePath: string): Promise<void> {
  const command = subagentLoginCommand(product, appPath, executablePath)
  if (process.platform === 'darwin') {
    await execute('/usr/bin/osascript', [
      '-e', 'tell application "Terminal" to activate',
      '-e', `tell application "Terminal" to do script "${appleScriptString(command)}"`,
    ])
    return
  }
  if (process.platform === 'win32') {
    spawn('powershell.exe', ['-NoExit', '-Command', command], { detached: true, stdio: 'ignore' }).unref()
    return
  }
  throw new Error('Linux 桌面登录需要先在终端运行对应 CLI 的 auth login 命令')
}

function appleScriptString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}
