/** Native Ollama discovery and local vision smoke testing for the desktop Host. */

const OLLAMA_NATIVE_BASE_URL = 'http://127.0.0.1:11434'
const TEST_IMAGE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

export type OllamaCapabilityState = 'supported' | 'unsupported' | 'unknown'

export interface OllamaModelStatus {
  readonly model: string
  readonly installed: boolean
  readonly diskBytes?: number
  readonly running: boolean
  readonly residentBytes?: number
  readonly vision: OllamaCapabilityState
  readonly detail: string
}

export interface OllamaStatus {
  readonly available: boolean
  readonly version?: string
  readonly installedModels: readonly { readonly name: string; readonly diskBytes?: number }[]
  readonly coding: OllamaModelStatus
  readonly vision: OllamaModelStatus
  readonly checkedAt: string
  readonly error?: string
}

interface OllamaStatusOptions {
  readonly codingModel: string
  readonly visionModel: string
  readonly timeoutMs?: number
}

interface InstalledModel {
  readonly name: string
  readonly size?: number
}

interface RunningModel {
  readonly name: string
  readonly size?: number
  readonly sizeVram?: number
}

/** Probe installed models, native capability metadata, and current residency. */
export async function inspectOllama(
  options: OllamaStatusOptions,
  fetcher: typeof fetch = fetch,
): Promise<OllamaStatus> {
  const timeoutMs = options.timeoutMs ?? 3_000
  const checkedAt = new Date().toISOString()
  try {
    const [versionResponse, tagsResponse, psResponse] = await Promise.all([
      get('/api/version', timeoutMs, fetcher),
      get('/api/tags', timeoutMs, fetcher),
      get('/api/ps', timeoutMs, fetcher),
    ])
    if (!tagsResponse.ok) throw new Error(`Ollama /api/tags returned HTTP ${tagsResponse.status}`)
    const installed = parseInstalledModels(await tagsResponse.json())
    const running = psResponse.ok ? parseRunningModels(await psResponse.json()) : []
    const version = versionResponse.ok ? parseVersion(await versionResponse.json()) : undefined
    const [coding, vision] = await Promise.all([
      inspectModel(options.codingModel, installed, running, timeoutMs, fetcher),
      inspectModel(options.visionModel, installed, running, timeoutMs, fetcher),
    ])
    return {
      available: true,
      ...(version === undefined ? {} : { version }),
      installedModels: installed.map(entry => ({
        name: entry.name,
        ...(entry.size === undefined ? {} : { diskBytes: entry.size }),
      })),
      coding,
      vision,
      checkedAt,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      available: false,
      installedModels: [],
      coding: unavailableModel(options.codingModel, message),
      vision: unavailableModel(options.visionModel, message),
      checkedAt,
      error: message,
    }
  }
}

/** Run a real OpenAI-compatible image request against the selected local model. */
export async function testOllamaVision(
  model: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 120_000,
): Promise<string> {
  const response = await fetcher(`${OLLAMA_NATIVE_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ollama-local' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: [
        { type: 'text', text: 'Describe this test image in one short sentence.' },
        { type: 'image_url', image_url: { url: TEST_IMAGE_DATA_URL } },
      ] }],
      max_tokens: 64,
      stream: false,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`Ollama vision test failed (HTTP ${response.status}): ${text.slice(0, 300)}`)
  const content = parseCompletionContent(text)
  if (content === undefined) throw new Error('Ollama vision test returned no assistant text')
  return content
}

function get(path: string, timeoutMs: number, fetcher: typeof fetch): Promise<Response> {
  return fetcher(`${OLLAMA_NATIVE_BASE_URL}${path}`, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) })
}

async function inspectModel(
  model: string,
  installed: readonly InstalledModel[],
  running: readonly RunningModel[],
  timeoutMs: number,
  fetcher: typeof fetch,
): Promise<OllamaModelStatus> {
  const installedEntry = installed.find(entry => entry.name === model)
  const runningEntry = running.find(entry => entry.name === model)
  if (installedEntry === undefined) {
    return { model, installed: false, running: false, vision: 'unknown', detail: '模型尚未下载' }
  }
  let vision: OllamaCapabilityState = 'unknown'
  let detail = '已安装；能力尚未确认'
  try {
    const response = await fetcher(`${OLLAMA_NATIVE_BASE_URL}/api/show`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (response.ok) {
      const capabilities = parseCapabilities(await response.json())
      if (capabilities !== undefined) {
        vision = capabilities.includes('vision') ? 'supported' : 'unsupported'
        detail = vision === 'supported' ? '已安装；支持图片输入' : '已安装；不支持图片输入'
      }
    }
  } catch {
    // A native metadata failure leaves capability unknown; OpenAI-compatible inference may still work.
  }
  const residentBytes = runningEntry?.sizeVram ?? runningEntry?.size
  return {
    model,
    installed: true,
    ...(installedEntry.size === undefined ? {} : { diskBytes: installedEntry.size }),
    running: runningEntry !== undefined,
    ...(residentBytes === undefined ? {} : { residentBytes }),
    vision,
    detail,
  }
}

function unavailableModel(model: string, message: string): OllamaModelStatus {
  return { model, installed: false, running: false, vision: 'unknown', detail: `Ollama 不可用：${message}` }
}

function parseInstalledModels(value: unknown): InstalledModel[] {
  const models = record(value)?.['models']
  if (!Array.isArray(models)) return []
  return models.flatMap((raw) => {
    const entry = record(raw)
    const name = string(entry?.['name']) ?? string(entry?.['model'])
    if (name === undefined) return []
    const size = finiteNumber(entry?.['size'])
    return [{ name, ...(size === undefined ? {} : { size }) }]
  })
}

function parseRunningModels(value: unknown): RunningModel[] {
  const models = record(value)?.['models']
  if (!Array.isArray(models)) return []
  return models.flatMap((raw) => {
    const entry = record(raw)
    const name = string(entry?.['name']) ?? string(entry?.['model'])
    if (name === undefined) return []
    const size = finiteNumber(entry?.['size'])
    const sizeVram = finiteNumber(entry?.['size_vram'])
    return [{ name, ...(size === undefined ? {} : { size }), ...(sizeVram === undefined ? {} : { sizeVram }) }]
  })
}

function parseCapabilities(value: unknown): readonly string[] | undefined {
  const capabilities = record(value)?.['capabilities']
  return Array.isArray(capabilities) && capabilities.every(value => typeof value === 'string')
    ? capabilities
    : undefined
}

function parseVersion(value: unknown): string | undefined {
  return string(record(value)?.['version'])
}

function parseCompletionContent(text: string): string | undefined {
  try {
    const choices = record(JSON.parse(text))?.['choices']
    if (!Array.isArray(choices)) return undefined
    return string(record(record(choices[0])?.['message'])?.['content'])
  } catch {
    return undefined
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}
