/** Local-model discovery and copy for the desktop first-run assistant. */

const OLLAMA_TAGS_URL = 'http://127.0.0.1:11434/api/tags'
export const RECOMMENDED_OLLAMA_MODEL = 'qwen3-coder:30b'

/** Result of probing the conventional local Ollama endpoint. */
export type OllamaProbe =
  | { readonly kind: 'ready'; readonly models: readonly string[] }
  | { readonly kind: 'model-missing'; readonly models: readonly string[] }
  | { readonly kind: 'unavailable'; readonly message: string }

interface OllamaTags {
  models?: readonly { name?: unknown; model?: unknown }[]
}

/** Extract model identifiers from Ollama's deliberately small tags response. */
export function parseOllamaModels(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return []
  const models = (value as OllamaTags).models
  if (!Array.isArray(models)) return []
  const entries = models as unknown[]
  return [...new Set(entries.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return []
    const record = entry as Record<string, unknown>
    const name = typeof record['name'] === 'string'
      ? record['name']
      : typeof record['model'] === 'string' ? record['model'] : undefined
    return name === undefined || name.length === 0 ? [] : [name]
  }))].sort()
}

/** Probe a local Ollama without sending prompts or reading model content. */
export async function probeOllama(
  fetcher: typeof fetch = fetch,
  timeoutMs = 2_000,
): Promise<OllamaProbe> {
  try {
    const response = await fetcher(OLLAMA_TAGS_URL, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return { kind: 'unavailable', message: `HTTP ${response.status}` }
    const models = parseOllamaModels(await response.json())
    return models.includes(RECOMMENDED_OLLAMA_MODEL)
      ? { kind: 'ready', models }
      : { kind: 'model-missing', models }
  } catch (error) {
    return {
      kind: 'unavailable',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Exact values understood by the existing custom-provider form. */
export function ollamaConfigurationText(): string {
  return [
    'Provider ID: ollama',
    'Display name / 显示名称: Ollama',
    'Base URL / 基础 URL: http://127.0.0.1:11434/v1',
    'API protocol / API 协议: openai-completions',
    'API Key: ollama-local',
    `Model / 模型: ${RECOMMENDED_OLLAMA_MODEL}`,
  ].join('\n')
}
