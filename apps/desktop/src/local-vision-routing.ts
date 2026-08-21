/** Agent-scoped local image routing for the native desktop Host. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { LlmCallConfig, UserMessage } from '@deepseek-ai/dsh-llm'

export interface LocalModelRoles {
  readonly provider: string
  readonly coding: string
  readonly vision: string
}

/** Return whether the proposed model-visible messages contain a durable image block. */
export function messagesContainImage(messages: readonly UserMessage[]): boolean {
  return messages.some(message => contentContainsImage(message.content))
}

/** Route only the configured local coding role to its paired vision role. */
export function routeImageRequest(
  config: LlmCallConfig,
  roles: LocalModelRoles,
  imageTurn: boolean,
): LlmCallConfig {
  if (!imageTurn || config.provider !== roles.provider || config.model !== roles.coding) return config
  const { reasoningEffort: _codingEffort, ...rest } = config
  return { ...rest, model: roles.vision }
}

/** Install per-turn image detection and request routing into one Host composition. */
export function installLocalVisionRouting(
  ctx: Context,
  roles: () => LocalModelRoles,
): () => void {
  const imageTurns = new WeakMap<Agent, number>()
  const disposePreStep = ctx.on('agent/pre-step', async (payload, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'enter' && messagesContainImage(decision.messages)) {
      imageTurns.set(payload.agent, payload.turn)
    } else if (imageTurns.get(payload.agent) !== payload.turn) {
      imageTurns.delete(payload.agent)
    }
    return decision
  })
  const disposeRequest = ctx.on('agent/request', async (payload, next): Promise<LlmCallConfig> => {
    const config = await next()
    return routeImageRequest(config, roles(), imageTurns.get(payload.agent) === payload.turn)
  })
  const disposeAgent = ctx.on('agent/disposed', ({ agent }) => { imageTurns.delete(agent) })
  return () => {
    disposePreStep()
    disposeRequest()
    disposeAgent()
  }
}

function contentContainsImage(content: readonly unknown[]): boolean {
  return content.some((raw) => {
    if (typeof raw !== 'object' || raw === null) return false
    const block = raw as { readonly type?: unknown; readonly content?: unknown }
    if (block.type === 'image') return true
    return block.type === 'tool-result' && Array.isArray(block.content) && contentContainsImage(block.content)
  })
}
