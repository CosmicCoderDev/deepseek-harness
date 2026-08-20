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
  type DesktopFetchResponse, type DesktopStreamEvent,
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
import { ensureDesktopPreset } from './desktop-preset.ts'
import {
  applyProxySettings,
  formatProxySnapshot,
  readProxySettings,
  writeProxySettings,
  type ProxySettings,
  type ProxySnapshot,
} from './proxy-settings.ts'
import { formatConnectivityResults, testProviderConnectivity } from './connectivity.ts'

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
let host: DesktopHost | undefined
let stopping = false
let stopped = false
let proxyHome = ''
let proxySnapshot: ProxySnapshot = applyProxySettings({ mode: 'direct' }, {})
let proxyRefresh: NodeJS.Timeout | undefined
const activeRequests = new Map<string, AbortController>()

function installApplicationMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: APP_NAME, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
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
          click: () => { void showProxySettings() },
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
  const status = await inspectSubagents(app.getAppPath())
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

async function showProxySettings(): Promise<void> {
  const options: MessageBoxOptions = {
    type: 'info',
    title: 'Proxy Settings / 代理设置',
    message: '桌面端代理管理',
    detail: `${formatProxySnapshot(proxySnapshot)}\n\n手动模式会读取剪贴板中的代理地址。`,
    buttons: ['自动系统代理', '手动（读取剪贴板）', '不使用代理', '测试连接', '复制诊断', '关闭'],
    defaultId: 0,
    cancelId: 5,
    noLink: true,
  }
  const result = mainWindow === undefined
    ? await dialog.showMessageBox(options)
    : await dialog.showMessageBox(mainWindow, options)
  if (result.response === 5) return
  if (result.response === 3) {
    await showConnectivityTest()
    return
  }
  if (result.response === 4) {
    clipboard.writeText(await createDesktopDiagnostics(diagnosticMetadata()))
    await dialog.showMessageBox({ type: 'info', title: APP_NAME, message: '诊断信息已复制并自动脱敏。' })
    return
  }
  const settings: ProxySettings = result.response === 0
    ? { mode: 'system' }
    : result.response === 1
      ? { mode: 'manual', url: clipboard.readText() }
      : { mode: 'direct' }
  try {
    await updateProxySettings(settings)
    await showProxySettings()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    recordDesktopDiagnostic('warn', 'proxy settings rejected', message)
    await dialog.showMessageBox({ type: 'error', title: '代理设置无效', message })
  }
}

async function updateProxySettings(settings: ProxySettings): Promise<void> {
  await writeProxySettings(proxyHome, settings)
  proxySnapshot = applyProxySettings(settings)
  recordDesktopDiagnostic('info', `proxy settings updated\n${formatProxySnapshot(proxySnapshot)}`)
}

async function showConnectivityTest(): Promise<void> {
  const results = await testProviderConnectivity()
  const detail = formatConnectivityResults(results)
  recordDesktopDiagnostic(results.every(result => result.ok) ? 'info' : 'warn', 'provider connectivity test', detail)
  await dialog.showMessageBox({
    type: results.every(result => result.ok) ? 'info' : 'warning',
    title: 'Connectivity Test / 连通性测试',
    message: '连接测试完成',
    detail,
    buttons: ['好'],
  })
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

async function handleFetch(event: IpcMainInvokeEvent, rawRequest: unknown): Promise<DesktopFetchResponse> {
  assertMainSender(event.sender.id)
  const request = parseDesktopFetchRequest(rawRequest)
  if (activeRequests.has(request.id)) throw new Error('desktop: duplicate IPC request id')
  const controller = new AbortController()
  activeRequests.set(request.id, controller)
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
    if (typeof id === 'string') activeRequests.get(id)?.abort()
  })
  ipcMain.on(IPC_BOOT, (event) => {
    assertMainSender(event.sender.id)
    event.returnValue = host?.graph
  })
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
    } catch {
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

async function stopHost(): Promise<void> {
  for (const controller of activeRequests.values()) controller.abort()
  activeRequests.clear()
  await host?.stop()
  host = undefined
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
    buttons: ['Copy Configuration / 复制配置', 'Close / 关闭'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  }
  const result = mainWindow === undefined
    ? await dialog.showMessageBox(options)
    : await dialog.showMessageBox(mainWindow, options)
  if (result.response === 0) clipboard.writeText(ollamaConfigurationText())
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
    proxySnapshot = applyProxySettings(await readProxySettings(dshHome))
    recordDesktopDiagnostic('info', `desktop proxy initialized\n${formatProxySnapshot(proxySnapshot)}`)
    proxyRefresh = setInterval(() => {
      if (proxySnapshot.settings.mode !== 'system') return
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
