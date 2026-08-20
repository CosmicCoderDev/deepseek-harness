import { describe, expect, it } from 'vitest'
import { formatSubagentStatus, parseClaudeAuth, parseCodexAuth } from '../src/subagent-status.ts'

describe('desktop subagent status', () => {
  it('recognizes authenticated bundled products', () => {
    expect(parseCodexAuth('Logged in using ChatGPT').authenticated).toBe(true)
    expect(parseCodexAuth('Not logged in').authenticated).toBe(false)
    expect(parseClaudeAuth('{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"pro"}'))
      .toMatchObject({ installed: true, authenticated: true, detail: 'claude.ai · pro' })
  })

  it('formats product and proxy state without credentials', () => {
    const text = formatSubagentStatus({
      codex: parseCodexAuth('Logged in using ChatGPT'),
      claude: parseClaudeAuth('{"loggedIn":false}'),
      proxy: 'http://127.0.0.1:7897',
    })
    expect(text).toContain('Codex: 已内置 · 已登录')
    expect(text).toContain('Claude Code: 已内置 · 未登录')
    expect(text).toContain('127.0.0.1:7897')
  })
})
