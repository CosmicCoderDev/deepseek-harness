import { describe, expect, it } from 'vitest'
import { formatConnectivityResults } from '../src/connectivity.ts'

describe('desktop connectivity status', () => {
  it('formats reachable and failed services distinctly', () => {
    expect(formatConnectivityResults([
      { service: 'OpenAI', ok: true, detail: '可连接（HTTP 401）' },
      { service: 'Ollama', ok: false, detail: '无法连接' },
    ])).toBe('✓ OpenAI: 可连接（HTTP 401）\n✗ Ollama: 无法连接')
  })
})
