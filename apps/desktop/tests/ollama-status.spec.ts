import { describe, expect, it, vi } from 'vitest'
import { estimatedModelDownloadBytes, inspectOllama, pullOllamaModel, testOllamaVision } from '../src/ollama-status.ts'

function response(value: unknown, status = 200): Response {
  return new Response(typeof value === 'string' ? value : JSON.stringify(value), { status })
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

describe('desktop Ollama status', () => {
  it('separates installed, resident, and native vision capability state', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = requestUrl(input)
      if (url.endsWith('/api/version')) return response({ version: '0.12.7' })
      if (url.endsWith('/api/tags')) return response({ models: [
        { name: 'qwen3-coder:30b', size: 18 },
        { name: 'qwen3-vl:8b', size: 6 },
      ] })
      if (url.endsWith('/api/ps')) return response({ models: [{ name: 'qwen3-vl:8b', size_vram: 4 }] })
      if (url.endsWith('/api/show')) {
        const body = JSON.parse(init?.body as string) as { model: string }
        return response({ capabilities: body.model.includes('-vl:') ? ['completion', 'vision'] : ['completion'] })
      }
      throw new Error(`unexpected URL ${url}`)
    }) as unknown as typeof fetch

    const status = await inspectOllama({ codingModel: 'qwen3-coder:30b', visionModel: 'qwen3-vl:8b' }, fetcher)
    expect(status.available).toBe(true)
    expect(status.version).toBe('0.12.7')
    expect(status.installedModels).toEqual([
      { name: 'qwen3-coder:30b', diskBytes: 18 },
      { name: 'qwen3-vl:8b', diskBytes: 6 },
    ])
    expect(status.coding).toMatchObject({ installed: true, running: false, vision: 'unsupported', diskBytes: 18 })
    expect(status.vision).toMatchObject({ installed: true, running: true, vision: 'supported', residentBytes: 4 })
    expect(status.offlineReady).toBe(true)
  })

  it('keeps capability unknown when old Ollama omits metadata', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = requestUrl(input)
      if (url.endsWith('/api/tags')) return response({ models: [{ name: 'custom-vision' }] })
      if (url.endsWith('/api/show')) return response({ details: {} })
      return response({ models: [] })
    }) as unknown as typeof fetch
    const status = await inspectOllama({ codingModel: 'missing', visionModel: 'custom-vision' }, fetcher)
    expect(status.vision.vision).toBe('unknown')
    expect(status.coding.installed).toBe(false)
    expect(status.offlineReady).toBe(true)
  })

  it('reports a successful OpenAI-compatible image inference', async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(typeof init?.body).toBe('string')
      expect(init?.body).toContain('image_url')
      return response({ choices: [{ message: { content: 'A white pixel.' } }] })
    }) as unknown as typeof fetch
    await expect(testOllamaVision('qwen3-vl:8b', fetcher)).resolves.toBe('A white pixel.')
  })

  it('reports an inference failure with response detail', async () => {
    const fetcher = vi.fn(async () => response('model not found', 404)) as unknown as typeof fetch
    await expect(testOllamaVision('missing', fetcher)).rejects.toThrow('model not found')
  })

  it('streams download progress from the native pull endpoint', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(requestUrl(input)).toBe('http://127.0.0.1:11434/api/pull')
      expect(JSON.parse(init?.body as string)).toEqual({ model: 'qwen3-vl:8b', stream: true })
      return response('{"status":"pulling manifest"}\n{"status":"downloading","completed":5,"total":10}\n{"status":"success"}\n')
    }) as unknown as typeof fetch
    const progress = vi.fn()
    await expect(pullOllamaModel('qwen3-vl:8b', fetcher, { onProgress: progress })).resolves.toBe('success')
    expect(progress).toHaveBeenCalledWith({ status: 'downloading', completed: 5, total: 10 })
  })

  it('cancels an active native model download', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => await new Promise<Response>(
      (_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const reason: unknown = init.signal?.reason
          reject(reason instanceof Error ? reason : new Error(String(reason)))
        }, { once: true })
      },
    )) as unknown as typeof fetch
    const pending = pullOllamaModel('qwen3-vl:8b', fetcher, { signal: controller.signal })
    controller.abort(new Error('cancelled by user'))
    await expect(pending).rejects.toThrow('cancelled by user')
  })

  it('provides conservative download estimates only for known recommended models', () => {
    expect(estimatedModelDownloadBytes('qwen3-vl:8b')).toBe(6 * 1024 ** 3)
    expect(estimatedModelDownloadBytes('qwen3-vl:30b')).toBe(20 * 1024 ** 3)
    expect(estimatedModelDownloadBytes('private-vision')).toBeUndefined()
  })
})
