import { describe, expect, it, vi } from 'vitest'
import {
  ollamaConfigurationText,
  parseOllamaModels,
  probeOllama,
  RECOMMENDED_OLLAMA_MODEL,
} from '../src/onboarding.ts'

describe('desktop Ollama onboarding', () => {
  it('parses, de-duplicates, and sorts model tags', () => {
    expect(parseOllamaModels({ models: [
      { name: 'z:latest' },
      { model: RECOMMENDED_OLLAMA_MODEL },
      { name: 'z:latest' },
      { name: 42 },
    ] })).toEqual([RECOMMENDED_OLLAMA_MODEL, 'z:latest'])
  })

  it('reports the recommended model as ready', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      models: [{ name: RECOMMENDED_OLLAMA_MODEL }],
    }))) as unknown as typeof fetch
    await expect(probeOllama(fetcher)).resolves.toEqual({
      kind: 'ready',
      models: [RECOMMENDED_OLLAMA_MODEL],
    })
  })

  it('distinguishes an available server without the recommended model', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ models: [] }))) as unknown as typeof fetch
    await expect(probeOllama(fetcher)).resolves.toEqual({ kind: 'model-missing', models: [] })
  })

  it('contains every value required by the custom provider form', () => {
    const copy = ollamaConfigurationText()
    expect(copy).toContain('ollama')
    expect(copy).toContain('http://127.0.0.1:11434/v1')
    expect(copy).toContain('openai-completions')
    expect(copy).toContain(RECOMMENDED_OLLAMA_MODEL)
  })
})
