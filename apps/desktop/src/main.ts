/** Native Electron shell with an in-process Host and least-authority IPC carrier. */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app, BrowserWindow, dialog, ipcMain, Menu, protocol, shell,
  type IpcMainInvokeEvent, type WebContents,
} from 'electron'
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

const APP_NAME = 'DeepSeek Harness'
const SMOKE_TEST = process.argv.includes('--smoke-test')

protocol.registerSchemesAsPrivileged([{
  scheme: 'dsh-plugin',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}])

let mainWindow: BrowserWindow | undefined
let host: DesktopHost | undefined
let stopping = false
let stopped = false
const activeRequests = new Map<string, AbortController>()

function installApplicationMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: APP_NAME, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]))
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
    if (target.startsWith('file:')) return
    event.preventDefault()
    if (isSafeExternalUrl(target)) void shell.openExternal(target)
  })
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[desktop] preload failed (${preloadPath}):`, error)
  })
  window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame) console.error(`[desktop] renderer load failed (${code} ${description}): ${url}`)
  })
  window.webContents.on('console-message', (details) => {
    if (details.level === 'warning' || details.level === 'error') {
      console.warn(`[renderer:${details.level}] ${details.sourceId}:${details.lineNumber} ${details.message}`)
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

function webIndexPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'web', 'index.html')
    : fileURLToPath(new URL('../../web/dist/index.html', import.meta.url))
}

async function openDesktop(reveal = true): Promise<void> {
  mainWindow ??= createWindow(reveal)
  await mainWindow.loadFile(webIndexPath())
}

async function waitForRenderer(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (mainWindow === undefined || mainWindow.isDestroyed()) {
      throw new Error('desktop: renderer window closed during packaged smoke test')
    }
    const ready = await mainWindow.webContents.executeJavaScript(
      "document.querySelector('#root')?.childElementCount > 0",
      true,
    ) as boolean
    if (ready) return
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
    installApplicationMenu()
    host = await startDesktopHost()
    installIpc()
    installPluginProtocol()
    await openDesktop(!SMOKE_TEST)
    if (SMOKE_TEST) {
      await waitForRenderer()
      console.log('[desktop] packaged smoke test passed')
      mainWindow?.destroy()
      await stopHost()
      stopped = true
      app.quit()
      return
    }
  }).catch(async (error: unknown) => {
    const detail = error instanceof Error ? error.stack ?? error.message : String(error)
    console.error('[desktop] startup failed:')
    console.dir(error, { depth: 12 })
    if (SMOKE_TEST) {
      stopped = true
      app.exit(1)
      return
    }
    await dialog.showMessageBox({
      type: 'error',
      title: `${APP_NAME} failed to start`,
      message: 'The local DeepSeek Harness Host could not start.',
      detail,
    })
    stopped = true
    app.quit()
  })
}
