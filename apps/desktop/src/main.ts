/** Native Electron shell with an in-process Host and least-authority IPC carrier. */

import { access, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app, BrowserWindow, clipboard, dialog, ipcMain, Menu, protocol, shell,
  type IpcMainInvokeEvent, type MessageBoxOptions, type WebContents,
} from 'electron'
import { injectBootManifest } from '@deepseek-ai/dsh-client-modules'
import {
  createDesktopDiagnostics,
  desktopLogPath,
  explainDesktopError,
  exportDesktopDiagnostics,
  initializeDesktopDiagnostics,
  recordDesktopDiagnostic,
} from './diagnostics.ts'
import { startDesktopHost, type DesktopHost } from './host.ts'
import {
  IPC_ABORT, IPC_BOOT, IPC_FETCH, IPC_STREAM,
  IPC_SETTINGS_COPY_DIAGNOSTICS, IPC_SETTINGS_GET, IPC_SETTINGS_LOGIN, IPC_SETTINGS_OPEN_LOGS,
  IPC_SETTINGS_REFRESH_STATUS, IPC_SETTINGS_RESTART_HOST, IPC_SETTINGS_SAVE,
  IPC_SETTINGS_STATUS_CHANGED, IPC_SETTINGS_TEST,
  type DesktopFetchResponse, type DesktopStreamEvent,
  type DesktopSettingsView,
} from './ipc-contract.ts'
import {
  isSafeExternalUrl,
  parseDesktopFetchRequest,
  parsePluginBundleUrl,
} from './security.ts'
import {
  ollamaConfigurationText,
  probeOllama,
  RECOMMENDED_OLLAMA_MODEL,
} from './onboarding.ts'
import { formatSubagentStatus, inspectSubagents } from './subagent-status.ts'
import { SubagentStatusService } from './subagent-status-service.ts'
import { openSubagentLogin } from './subagent-login.ts'
import { ensureDesktopPreset } from './desktop-preset.ts'
import {
  applyProxySettings,
  formatProxySnapshot,
  type ProxySnapshot,
} from './proxy-settings.ts'
import { formatConnectivityResults, testProviderConnectivity } from './connectivity.ts'
import {
  applySubagentPermission,
  readDesktopSettingsWithRecovery,
  validateDesktopSettings,
  writeDesktopSettings,
  type DesktopSettings,
} from './desktop-settings.ts'

const APP_NAME = 'DeepSeek Harness'
const SMOKE_TEST = process.argv.includes('--smoke-test')
const ONBOARDING_MARKER = 'desktop-local-model-onboarding-v1'

protocol.registerSchemesAsPrivileged([{
  scheme: 'dsh-plugin',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}, {
  scheme: 'dsh-app',
  privileges: { standard: true, secure: true, supportFetchAPI: true },
}])

let mainWindow: BrowserWindow | undefined
let settingsWindow: BrowserWindow | undefined
let host: DesktopHost | undefined
let stopping = false
let stopped = false
let proxyHome = ''
let proxySnapshot: ProxySnapshot = applyProxySettings({ mode: 'direct' }, {})
let desktopSettings: DesktopSettings = {
  version: 1,
  proxy: { mode: 'system' },
  subagentPermission: 'read-only',
}
let proxyRefresh: NodeJS.Timeout | undefined
let statusRefresh: NodeJS.Timeout | undefined
let statusService: SubagentStatusService | undefined
let settingsRecoveryWarning: string | undefined
let restartRequired = false
let hostRestarting = false
const activeRequests = new Map<string, { controller: AbortController; url: string }>()

function installApplicationMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: APP_NAME, submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Desktop Settings… / 桌面设置…', accelerator: 'CommandOrControl+,', click: openSettingsWindow }, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Local Model Setup / 本地模型设置',
          click: () => { void showLocalModelSetup(false) },
        },
        {
          label: 'Codex & Claude Status / 子代理状态',
          click: () => { void showSubagentStatus() },
        },
        {
          label: 'Proxy Settings / 代理设置',
          click: openSettingsWindow,
        },
        { type: 'separator' },
        {
          label: 'Open Logs Folder / 打开日志目录',
          click: () => { void openLogsFolder() },
        },
        {
          label: 'Export Diagnostics… / 导出诊断…',
          click: () => { void saveDiagnostics() },
        },
      ],
    },
  ]))
}

async function showSubagentStatus(): Promise<void> {
  const status = (await requiredStatusService().refresh()).status
  const options: MessageBoxOptions = {
    type: status.codex.authenticated && status.claude.authenticated ? 'info' : 'warning',
    title: 'Codex & Claude Code',
    message: 'AI 子代理状态',
    detail: formatSubagentStatus(status),
    buttons: ['好'],
  }
  await (mainWindow === undefined
    ? dialog.showMessageBox(options)
    : dialog.showMessageBox(mainWindow, options))
}

function openSettingsWindow(): BrowserWindow {
  if (settingsWindow !== undefined && !settingsWindow.isDestroyed()) {
    settingsWindow.show()
    settingsWindow.focus()
    return settingsWindow
  }
  const window = new BrowserWindow({
    title: 'DeepSeek Harness Desktop Settings',
    width: 900,
    height: 820,
    minWidth: 720,
    minHeight: 640,
    ...(mainWindow === undefined ? {} : { parent: mainWindow }),
    show: false,
    backgroundColor: '#f4f5f7',
    webPreferences: {
      preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => { event.preventDefault() })
  window.once('ready-to-show', () => { window.show() })
  window.on('closed', () => { settingsWindow = undefined })
  settingsWindow = window
  void window.loadFile(join(app.getAppPath(), 'assets', 'settings.html')).catch((error: unknown) => {
    recordDesktopDiagnostic('error', 'desktop settings page failed to load', error)
  })
  return window
}

function diagnosticMetadata(): Record<string, string> {
  return {
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: `${process.platform}-${process.arch}`,
    packaged: String(app.isPackaged),
    proxy: formatProxySnapshot(proxySnapshot).replace(/\n/gu, '; '),
  }
}

function createWindow(reveal = true): BrowserWindow {
  const window = new BrowserWindow({
    title: APP_NAME,
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#f7f8fa',
    webPreferences: {
      // Sandboxed preload scripts need a self-contained CommonJS bundle. Electron's
      // sandboxed `require` cannot follow arbitrary local module imports.
      preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, target) => {
    if (target.startsWith('dsh-app://app/')) return
    event.preventDefault()
    if (isSafeExternalUrl(target)) void shell.openExternal(target)
  })
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    recordDesktopDiagnostic('error', `preload failed (${preloadPath})`, error)
  })
  window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame) recordDesktopDiagnostic('error', `renderer load failed (${code} ${description}): ${url}`)
  })
  window.webContents.on('console-message', (details) => {
    if (details.level === 'warning' || details.level === 'error') {
      recordDesktopDiagnostic('warn', `[renderer:${details.level}] ${details.sourceId}:${details.lineNumber} ${details.message}`)
    }
  })
  if (reveal) window.once('ready-to-show', () => { window.show() })
  window.on('closed', () => { mainWindow = undefined })
  return window
}

function assertMainSender(senderId: number): void {
  if (mainWindow === undefined || mainWindow.webContents.id !== senderId) {
    throw new Error('desktop: rejected IPC from an unknown renderer')
  }
}

function assertSettingsSender(senderId: number): void {
  if (settingsWindow === undefined || settingsWindow.webContents.id !== senderId) {
    throw new Error('desktop: rejected settings IPC from an unknown renderer')
  }
}

async function handleFetch(event: IpcMainInvokeEvent, rawRequest: unknown): Promise<DesktopFetchResponse> {
  assertMainSender(event.sender.id)
  const request = parseDesktopFetchRequest(rawRequest)
  if (activeRequests.has(request.id)) throw new Error('desktop: duplicate IPC request id')
  const controller = new AbortController()
  activeRequests.set(request.id, { controller, url: request.url })
  try {
    if (host === undefined) throw new Error('desktop: Host is not ready')
    const response = await host.fetch(new Request(request.url, {
      method: request.method,
      headers: [...request.headers],
      ...(request.body === undefined ? {} : { body: request.body }),
      signal: controller.signal,
    }))
    const headers = [...response.headers.entries()]
    if (response.headers.get('content-type')?.startsWith('text/event-stream') === true
      && response.body !== null) {
      void pumpStream(event.sender, request.id, response.body, controller)
      return { status: response.status, headers, stream: true }
    }
    const body = new Uint8Array(await response.arrayBuffer())
    activeRequests.delete(request.id)
    return { status: response.status, headers, body, stream: false }
  } catch (error) {
    activeRequests.delete(request.id)
    throw error
  }
}

async function pumpStream(
  sender: WebContents,
  id: string,
  body: ReadableStream<Uint8Array>,
  controller: AbortController,
): Promise<void> {
  const reader = body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!sender.isDestroyed()) sendStream(sender, id, { type: 'chunk', data: value })
    }
    if (!sender.isDestroyed()) sendStream(sender, id, { type: 'end' })
  } catch (error) {
    if (!controller.signal.aborted && !sender.isDestroyed()) {
      sendStream(sender, id, { type: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  } finally {
    activeRequests.delete(id)
    await reader.cancel().catch(() => undefined)
  }
}

function sendStream(sender: WebContents, id: string, event: DesktopStreamEvent): void {
  sender.send(IPC_STREAM, id, event)
}

function installIpc(): void {
  ipcMain.handle(IPC_FETCH, handleFetch)
  ipcMain.on(IPC_ABORT, (event, id: unknown) => {
    assertMainSender(event.sender.id)
    if (typeof id === 'string') activeRequests.get(id)?.controller.abort()
  })
  ipcMain.on(IPC_BOOT, (event) => {
    if (settingsWindow?.webContents.id === event.sender.id) {
      event.returnValue = undefined
    } else {
      assertMainSender(event.sender.id)
      event.returnValue = host?.graph
    }
  })
  ipcMain.handle(IPC_SETTINGS_GET, async (event) => {
    assertSettingsSender(event.sender.id)
    return await desktopSettingsView()
  })
  ipcMain.handle(IPC_SETTINGS_SAVE, async (event, raw: unknown, confirmFullAccess: unknown) => {
    assertSettingsSender(event.sender.id)
    const next = validateDesktopSettings(raw)
    if (next.subagentPermission === 'full-access' && confirmFullAccess !== true) {
      throw new Error('完全访问需要用户二次确认')
    }
    const permissionChanged = next.subagentPermission !== desktopSettings.subagentPermission
    await writeDesktopSettings(proxyHome, next)
    desktopSettings = next
    settingsRecoveryWarning = undefined
    proxySnapshot = applyProxySettings(next.proxy)
    applySubagentPermission(next.subagentPermission)
    restartRequired ||= permissionChanged
    recordDesktopDiagnostic('info', `desktop settings updated\n${formatProxySnapshot(proxySnapshot)}\npermission: ${next.subagentPermission}`)
    return await desktopSettingsView()
  })
  ipcMain.handle(IPC_SETTINGS_TEST, async (event) => {
    assertSettingsSender(event.sender.id)
    const results = await testProviderConnectivity()
    const detail = formatConnectivityResults(results)
    recordDesktopDiagnostic(results.every(result => result.ok) ? 'info' : 'warn', 'provider connectivity test', detail)
    return detail
  })
  ipcMain.handle(IPC_SETTINGS_COPY_DIAGNOSTICS, async (event) => {
    assertSettingsSender(event.sender.id)
    clipboard.writeText(await createDesktopDiagnostics(diagnosticMetadata()))
  })
  ipcMain.handle(IPC_SETTINGS_OPEN_LOGS, async (event) => {
    assertSettingsSender(event.sender.id)
    await openLogsFolder()
  })
  ipcMain.handle(IPC_SETTINGS_LOGIN, async (event, product: unknown) => {
    assertSettingsSender(event.sender.id)
    if (product !== 'codex' && product !== 'claude') throw new Error('未知的子代理登录类型')
    recordDesktopDiagnostic('info', `opening ${product} login in Terminal`)
    await openSubagentLogin(product, app.getAppPath(), process.execPath)
  })
  ipcMain.handle(IPC_SETTINGS_REFRESH_STATUS, async (event) => {
    assertSettingsSender(event.sender.id)
    await requiredStatusService().refresh()
    return await desktopSettingsView()
  })
  ipcMain.handle(IPC_SETTINGS_RESTART_HOST, async (event) => {
    assertSettingsSender(event.sender.id)
    await restartDesktopHost()
    return await desktopSettingsView()
  })
}

async function desktopSettingsView(): Promise<DesktopSettingsView> {
  const snapshot = await requiredStatusService().get()
  return {
    settings: desktopSettings,
    proxySummary: formatProxySnapshot(proxySnapshot),
    codex: snapshot.status.codex,
    claude: snapshot.status.claude,
    statusCheckedAt: snapshot.checkedAt,
    restartRequired,
    ...(settingsRecoveryWarning === undefined ? {} : { recoveryWarning: settingsRecoveryWarning }),
  }
}

function requiredStatusService(): SubagentStatusService {
  if (statusService === undefined) throw new Error('子代理状态服务尚未启动')
  return statusService
}

function installPluginProtocol(): void {
  protocol.handle('dsh-plugin', async (request) => {
    if (host === undefined) return new Response('Host unavailable', { status: 503 })
    const target = parsePluginBundleUrl(request.url)
    if (target === undefined) return new Response('not found', { status: 404 })
    const bundle = host.clientBundlePath(target.id)
    if (bundle === undefined) return new Response('not found', { status: 404 })
    try {
      const content = await readFile(target.sourceMap ? `${bundle}.map` : bundle)
      return new Response(content, {
        headers: { 'content-type': target.sourceMap ? 'application/json' : 'text/javascript; charset=utf-8' },
      })
    } catch (error) {
      recordDesktopDiagnostic('warn', `plugin bundle unavailable: ${target.id}`, error)
      return new Response('not found', { status: 404 })
    }
  })
}

function webRootPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'web') : fileURLToPath(new URL('../../web/dist', import.meta.url))
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function installApplicationProtocol(): void {
  protocol.handle('dsh-app', async (request) => {
    if (host === undefined) return new Response('Host unavailable', { status: 503 })
    const url = new URL(request.url)
    if (url.hostname !== 'app') return new Response('not found', { status: 404 })
    const root = resolve(webRootPath())
    const pathname = decodeURIComponent(url.pathname)
    const target = resolve(root, `.${pathname}`)
    if (target !== root && !target.startsWith(`${root}${sep}`)) return new Response('not found', { status: 404 })
    try {
      if (pathname === '/' || pathname === '/index.html') {
        const html = await readFile(join(root, 'index.html'), 'utf8')
        return new Response(injectBootManifest(html, host.graph), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      }
      const content = await readFile(target)
      return new Response(content, {
        headers: { 'content-type': CONTENT_TYPES[extname(target)] ?? 'application/octet-stream' },
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}

async function openDesktop(reveal = true): Promise<void> {
  mainWindow ??= createWindow(reveal)
  await mainWindow.loadURL('dsh-app://app/index.html')
}

async function waitForRenderer(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (mainWindow === undefined || mainWindow.isDestroyed()) {
      throw new Error('desktop: renderer window closed during packaged smoke test')
    }
    const state = await mainWindow.webContents.executeJavaScript(
      "({ ready: document.querySelector('[data-slot=\"root\"]') !== null, boot: document.querySelector('[data-dsh-boot]')?.textContent ?? '' })",
      true,
    ) as { ready: boolean; boot: string }
    if (state.ready) return
    if (state.boot.includes('Failed to load plugins')) throw new Error(`desktop: renderer boot failed: ${state.boot}`)
    await new Promise((resolvePromise) => { setTimeout(resolvePromise, 250) })
  }
  throw new Error('desktop: renderer did not mount during packaged smoke test')
}

async function verifyPackagedSettingsSurface(): Promise<void> {
  const window = openSettingsWindow()
  if (window.webContents.isLoading()) {
    await new Promise<void>((resolvePromise, reject) => {
      window.webContents.once('did-finish-load', () => { resolvePromise() })
      window.webContents.once('did-fail-load', (_event, code, description) => {
        reject(new Error(`desktop: settings load failed (${code} ${description})`))
      })
    })
  }
  const result = await window.webContents.executeJavaScript(`(async () => {
    if (document.querySelector('#save') === null || document.querySelector('#loginCodex') === null || document.querySelector('#loginClaude') === null) throw new Error('settings controls missing')
    if (typeof window.__DSH_SETTINGS__.login !== 'function') throw new Error('settings login bridge missing')
    const initial = await window.__DSH_SETTINGS__.get()
    if (!initial.recoveryWarning) throw new Error('corrupt settings recovery warning missing')
    let unsafeSaveRejected = false
    try {
      await window.__DSH_SETTINGS__.save({
        version: 1,
        proxy: { mode: 'direct' },
        subagentPermission: 'full-access'
      }, false)
    } catch {
      unsafeSaveRejected = true
    }
    if (!unsafeSaveRejected) throw new Error('full access was saved without confirmation')
    const saved = await window.__DSH_SETTINGS__.save({
      version: 1,
      proxy: { mode: 'direct' },
      subagentPermission: 'project-development'
    }, false)
    if (!saved.restartRequired) throw new Error('permission change did not require Host restart')
    const restarted = await window.__DSH_SETTINGS__.restartHost()
    return { mode: restarted.settings.proxy.mode, permission: restarted.settings.subagentPermission, restartRequired: restarted.restartRequired }
  })()`, true) as { mode: string; permission: string; restartRequired: boolean }
  if (result.mode !== 'direct' || result.permission !== 'project-development' || result.restartRequired) {
    throw new Error('desktop: packaged settings did not persist through IPC')
  }
  window.destroy()
}

async function stopHost(): Promise<void> {
  for (const request of activeRequests.values()) request.controller.abort()
  activeRequests.clear()
  await host?.stop()
  host = undefined
}

async function restartDesktopHost(): Promise<void> {
  if (hostRestarting) throw new Error('桌面 Host 正在重启，请稍候')
  const hasRunningTask = [...activeRequests.values()].some(({ url }) => {
    const pathname = new URL(url, 'http://desktop.invalid').pathname
    return pathname === '/api/session.prompt' || pathname === '/api/subagent.prompt'
  })
  if (hasRunningTask) throw new Error('当前仍有运行中的任务，请等待任务完成后再重启 Host')
  hostRestarting = true
  try {
    recordDesktopDiagnostic('info', 'desktop Host restart requested')
    await stopHost()
    applySubagentPermission(desktopSettings.subagentPermission)
    host = await startDesktopHost()
    restartRequired = false
    await openDesktop(false)
    recordDesktopDiagnostic('info', 'desktop Host restarted')
  } catch (error) {
    recordDesktopDiagnostic('error', 'desktop Host restart failed', error)
    const safe = { ...desktopSettings, subagentPermission: 'read-only' as const }
    desktopSettings = safe
    await writeDesktopSettings(proxyHome, safe)
    applySubagentPermission('read-only')
    host = await startDesktopHost().catch((recoveryError: unknown) => {
      recordDesktopDiagnostic('error', 'desktop Host safe recovery failed', recoveryError)
      return undefined
    })
    restartRequired = host === undefined
    if (host !== undefined) await openDesktop(false)
    throw new Error(`桌面 Host 重启失败：${explainDesktopError('Desktop Host', error).detail}`)
  } finally {
    hostRestarting = false
  }
}

async function onboardingWasShown(): Promise<boolean> {
  try {
    await access(join(app.getPath('userData'), ONBOARDING_MARKER))
    return true
  } catch {
    return false
  }
}

async function markOnboardingShown(): Promise<void> {
  await writeFile(join(app.getPath('userData'), ONBOARDING_MARKER), new Date().toISOString(), 'utf8')
}

async function showLocalModelSetup(firstRun: boolean): Promise<void> {
  const probe = await probeOllama()
  const status = probe.kind === 'ready'
    ? `已检测到 Ollama 和 ${RECOMMENDED_OLLAMA_MODEL}。\nOllama and ${RECOMMENDED_OLLAMA_MODEL} were detected.`
    : probe.kind === 'model-missing'
      ? `已检测到 Ollama，但没有 ${RECOMMENDED_OLLAMA_MODEL}。请先运行：\nollama pull ${RECOMMENDED_OLLAMA_MODEL}\n\nOllama is running, but the recommended model is missing.`
      : '没有检测到本机 Ollama。请先启动 Ollama。\nLocal Ollama was not detected. Start Ollama first.'
  recordDesktopDiagnostic('info', `Ollama onboarding probe: ${probe.kind}`)
  const options = {
    type: probe.kind === 'ready' ? 'info' as const : 'warning' as const,
    title: 'Local Model Setup / 本地模型设置',
    message: status,
    detail: [
      '在应用中打开“设置 → 模型 → 添加自定义提供方”，填写以下内容：',
      'Open “Settings → Models → Add a custom provider” and enter:',
      '',
      ollamaConfigurationText(),
    ].join('\n'),
    buttons: ['Open Desktop Settings / 打开桌面设置', 'Copy Configuration / 复制配置', 'Close / 关闭'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  }
  const result = mainWindow === undefined
    ? await dialog.showMessageBox(options)
    : await dialog.showMessageBox(mainWindow, options)
  if (result.response === 0) openSettingsWindow()
  if (result.response === 1) clipboard.writeText(ollamaConfigurationText())
  if (firstRun) await markOnboardingShown()
}

async function openLogsFolder(): Promise<void> {
  const currentLog = desktopLogPath()
  const path = currentLog === undefined ? app.getPath('logs') : dirname(currentLog)
  const error = await shell.openPath(path)
  if (error.length > 0) {
    recordDesktopDiagnostic('error', 'failed to open logs folder', error)
    dialog.showErrorBox('DeepSeek Harness', error)
  }
}

async function saveDiagnostics(): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/gu, '-')
  const options = {
    title: 'Export Diagnostics / 导出诊断',
    defaultPath: join(app.getPath('documents'), `DeepSeek-Harness-diagnostics-${timestamp}.txt`),
    filters: [{ name: 'Text', extensions: ['txt'] }],
  }
  const result = mainWindow === undefined
    ? await dialog.showSaveDialog(options)
    : await dialog.showSaveDialog(mainWindow, options)
  if (result.canceled) return
  try {
    await exportDesktopDiagnostics(result.filePath, diagnosticMetadata())
    recordDesktopDiagnostic('info', `diagnostics exported to ${result.filePath}`)
  } catch (error) {
    recordDesktopDiagnostic('error', 'failed to export diagnostics', error)
    dialog.showErrorBox('DeepSeek Harness', error instanceof Error ? error.message : String(error))
  }
}

function revealMainWindow(): void {
  if (mainWindow === undefined || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

app.setName(APP_NAME)
const ownsInstance = SMOKE_TEST || app.requestSingleInstanceLock()
if (!ownsInstance) {
  app.quit()
} else {
  app.on('second-instance', revealMainWindow)
  app.on('web-contents-created', (_event, contents) => {
    contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => { callback(false) })
  })
  app.on('before-quit', (event) => {
    if (stopped) return
    event.preventDefault()
    if (stopping) return
    stopping = true
    if (proxyRefresh !== undefined) clearInterval(proxyRefresh)
    if (statusRefresh !== undefined) clearInterval(statusRefresh)
    void stopHost().finally(() => {
      stopped = true
      app.quit()
    })
  })
  app.on('window-all-closed', () => { app.quit() })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void openDesktop()
    else revealMainWindow()
  })

  void app.whenReady().then(async () => {
    try {
      await initializeDesktopDiagnostics(app.getPath('logs'))
    } catch (error) {
      console.error('[desktop] diagnostic log initialization failed', error)
    }
    installApplicationMenu()
    process.on('uncaughtExceptionMonitor', (error) => {
      recordDesktopDiagnostic('error', 'uncaught exception', error)
    })
    process.on('unhandledRejection', (error) => {
      recordDesktopDiagnostic('error', 'unhandled rejection', error)
    })
    const dshHome = process.env.DSH_HOME ?? join(app.getPath('home'), '.dsh')
    proxyHome = dshHome
    const settingsResult = await readDesktopSettingsWithRecovery(dshHome)
    desktopSettings = settingsResult.settings
    settingsRecoveryWarning = settingsResult.recoveryWarning
    if (settingsRecoveryWarning !== undefined) {
      recordDesktopDiagnostic('warn', settingsRecoveryWarning)
    }
    applySubagentPermission(desktopSettings.subagentPermission)
    proxySnapshot = applyProxySettings(desktopSettings.proxy)
    statusService = new SubagentStatusService(
      async () => await inspectSubagents(app.getAppPath()),
      () => {
        if (settingsWindow !== undefined && !settingsWindow.isDestroyed()) {
          settingsWindow.webContents.send(IPC_SETTINGS_STATUS_CHANGED)
        }
      },
    )
    void statusService.refresh().catch((error: unknown) => {
      recordDesktopDiagnostic('warn', 'initial subagent status refresh failed', error)
    })
    statusRefresh = setInterval(() => {
      void statusService?.refresh().catch((error: unknown) => {
        recordDesktopDiagnostic('warn', 'background subagent status refresh failed', error)
      })
    }, 30_000)
    statusRefresh.unref()
    recordDesktopDiagnostic('info', `desktop proxy initialized\n${formatProxySnapshot(proxySnapshot)}`)
    proxyRefresh = setInterval(() => {
      if (desktopSettings.proxy.mode !== 'system') return
      const next = applyProxySettings(proxySnapshot.settings)
      if (JSON.stringify(next.environment) === JSON.stringify(proxySnapshot.environment)) return
      proxySnapshot = next
      recordDesktopDiagnostic('info', `macOS system proxy changed\n${formatProxySnapshot(proxySnapshot)}`)
    }, 5_000)
    proxyRefresh.unref()
    if (await ensureDesktopPreset(join(app.getAppPath(), 'config'), dshHome)) {
      recordDesktopDiagnostic('info', 'desktop Codex + Claude Code preset installed')
    }
    host = await startDesktopHost()
    recordDesktopDiagnostic('info', 'in-process Host started')
    installIpc()
    installPluginProtocol()
    installApplicationProtocol()
    await openDesktop(!SMOKE_TEST)
    if (SMOKE_TEST) {
      if (host.toolNames.includes('web_search')) {
        throw new Error('desktop: local-first build unexpectedly exposes web_search')
      }
      await waitForRenderer()
      await verifyPackagedSettingsSurface()
      console.log('[desktop] packaged smoke test passed')
      mainWindow?.destroy()
      await stopHost()
      stopped = true
      app.quit()
      return
    }
    if (!await onboardingWasShown()) {
      await showLocalModelSetup(true).catch((error: unknown) => {
        recordDesktopDiagnostic('warn', 'local model onboarding failed', error)
      })
    }
  }).catch(async (error: unknown) => {
    const explained = explainDesktopError('Network', error)
    const detail = `${explained.detail}\n\n${explained.action}`
    recordDesktopDiagnostic('error', 'startup failed', error)
    if (SMOKE_TEST) {
      stopped = true
      app.exit(1)
      return
    }
    await dialog.showMessageBox({
      type: 'error',
      title: `${APP_NAME} failed to start`,
      message: explained.title,
      detail,
    })
    stopped = true
    app.quit()
  })
}
