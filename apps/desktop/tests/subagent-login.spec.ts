import { describe, expect, it } from 'vitest'
import { subagentLoginCommand } from '../src/subagent-login.ts'

describe('desktop subagent login command', () => {
  it('uses Electron Node mode for the bundled Codex wrapper', () => {
    const command = subagentLoginCommand('codex', '/Applications/DeepSeek Harness.app/Contents/Resources/app', '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness')
    expect(command).toContain('ELECTRON_RUN_AS_NODE=1')
    expect(command).toContain("'/Applications/DeepSeek Harness.app/Contents/Resources/app/node_modules/@openai/codex/bin/codex.js'")
    expect(command.endsWith(' login')).toBe(true)
  })

  it('uses only the bundled Claude Code binary', () => {
    const command = subagentLoginCommand('claude', '/tmp/App Resources', '/ignored')
    expect(command).toBe("'/tmp/App Resources/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude' auth login")
  })
})
