import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type Agent, type PreStepDecision } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId, type LlmCallConfig, type UserMessage } from '@deepseek-ai/dsh-llm'
import { installLocalVisionRouting, messagesContainImage, routeImageRequest } from '../src/local-vision-routing.ts'

const roles = { provider: 'ollama', coding: 'qwen3-coder:30b', vision: 'gemma4:31b-it-qat' }

describe('desktop local vision routing', () => {
  it('detects direct and tool-result images', () => {
    expect(messagesContainImage([{ role: 'user', content: [{ type: 'image', attachment: 'image:test' }] }] as unknown as UserMessage[])).toBe(true)
    expect(messagesContainImage([{ role: 'user', content: [{ type: 'tool-result', toolCallId: 'call:test', content: [{ type: 'image', attachment: 'image:test' }] }] }] as unknown as UserMessage[])).toBe(true)
    expect(messagesContainImage([{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] as UserMessage[])).toBe(false)
  })

  it('switches only the configured local coding route and clears its effort', () => {
    expect(routeImageRequest({ provider: 'ollama', model: 'qwen3-coder:30b', reasoningEffort: ReasoningEffortId('high') }, roles, true)).toEqual({
      provider: 'ollama',
      model: 'gemma4:31b-it-qat',
    })
    expect(routeImageRequest({ provider: 'ollama', model: 'other' }, roles, true)).toEqual({ provider: 'ollama', model: 'other' })
    expect(routeImageRequest({ provider: 'ollama', model: 'qwen3-coder:30b' }, roles, false)).toEqual({ provider: 'ollama', model: 'qwen3-coder:30b' })
  })

  it('keeps an image turn on vision and restores coding on the next text turn', async () => {
    const ctx = new Context()
    const agent = {} as Agent
    const events = agentEvents(ctx, agent)
    const signal = new AbortController().signal
    const coding: LlmCallConfig = { provider: 'ollama', model: 'qwen3-coder:30b' }
    const image = [{ role: 'user', content: [{ type: 'image', attachment: 'image:test' }] }] as unknown as UserMessage[]
    const text = [{ role: 'user', content: [{ type: 'text', text: 'continue' }] }] as UserMessage[]
    const dispose = installLocalVisionRouting(ctx, () => roles)

    await events.waterfall('agent/pre-step', { messages: image, turn: 1, step: 1, signal }, () => (
      Promise.resolve<PreStepDecision>({ kind: 'enter', messages: image })
    ))
    await expect(events.waterfall('agent/request', { turn: 1, step: 1, signal }, () => Promise.resolve(coding)))
      .resolves.toMatchObject({ model: 'gemma4:31b-it-qat' })
    await events.waterfall('agent/pre-step', { messages: text, turn: 1, step: 2, signal }, () => (
      Promise.resolve<PreStepDecision>({ kind: 'enter', messages: text })
    ))
    await expect(events.waterfall('agent/request', { turn: 1, step: 2, signal }, () => Promise.resolve(coding)))
      .resolves.toMatchObject({ model: 'gemma4:31b-it-qat' })
    await events.waterfall('agent/pre-step', { messages: text, turn: 2, step: 3, signal }, () => (
      Promise.resolve<PreStepDecision>({ kind: 'enter', messages: text })
    ))
    await expect(events.waterfall('agent/request', { turn: 2, step: 3, signal }, () => Promise.resolve(coding)))
      .resolves.toBe(coding)

    dispose()
    await ctx.fiber.dispose()
  })
})
