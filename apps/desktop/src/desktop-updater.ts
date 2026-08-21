/** User-confirmed desktop update checks backed by published GitHub artifacts. */

import { app, BrowserWindow, dialog } from 'electron'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

export interface DesktopUpdaterOptions {
  readonly window: () => BrowserWindow | undefined
  readonly report: (level: 'info' | 'warn' | 'error', message: string, detail?: unknown) => void
}

/** Install periodic update checks. Returns cleanup for application shutdown. */
export function installDesktopUpdater(options: DesktopUpdaterOptions): () => void {
  if (!app.isPackaged) return () => {}
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('error', (error) => { options.report('warn', 'desktop update failed', error) })
  autoUpdater.on('update-not-available', () => {
    options.report('info', 'desktop update check: current version is latest')
  })
  autoUpdater.on('update-available', (info) => {
    void confirmDownload(info.version)
  })
  autoUpdater.on('download-progress', (progress) => {
    options.report('info', `desktop update download ${progress.percent.toFixed(1)}%`)
  })
  autoUpdater.on('update-downloaded', (info) => {
    void confirmInstall(info.version)
  })

  const check = (): void => {
    void autoUpdater.checkForUpdates().catch((error: unknown) => {
      options.report('warn', 'desktop update check failed', error)
    })
  }
  const initial = setTimeout(check, 30_000)
  initial.unref()
  const periodic = setInterval(check, 6 * 60 * 60 * 1_000)
  periodic.unref()
  return () => {
    clearTimeout(initial)
    clearInterval(periodic)
    autoUpdater.removeAllListeners()
  }

  async function confirmDownload(version: string): Promise<void> {
    options.report('info', `desktop update available: ${version}`)
    const answer = await show({
      type: 'info',
      title: 'DeepSeek Harness Update',
      message: `发现新版本 ${version}`,
      detail: '是否现在下载？下载完成前可以继续使用当前版本。',
      buttons: ['下载', '稍后'],
      defaultId: 0,
      cancelId: 1,
    })
    if (answer.response === 0) await autoUpdater.downloadUpdate()
  }

  async function confirmInstall(version: string): Promise<void> {
    const answer = await show({
      type: 'info',
      title: 'DeepSeek Harness Update',
      message: `版本 ${version} 已下载完成`,
      detail: '是否立即重启并安装？',
      buttons: ['重启安装', '退出时安装'],
      defaultId: 0,
      cancelId: 1,
    })
    if (answer.response === 0) autoUpdater.quitAndInstall(false, true)
  }

  async function show(configuration: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
    const window = options.window()
    return window === undefined ? await dialog.showMessageBox(configuration) : await dialog.showMessageBox(window, configuration)
  }
}
