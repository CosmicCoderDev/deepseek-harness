/** In-process Harness Host composition for the native desktop carrier. */

import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { SubagentPermissionTier } from '@deepseek-ai/dsh-subagent'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { ClientModuleRegistry, WebBootGraph } from '@deepseek-ai/dsh-client-modules'
import { installLocalVisionRouting, type LocalModelRoles } from './local-vision-routing.ts'

/** Ready in-process Host and the local assets selected by its client graph. */
export interface DesktopHost {
  readonly fetch: (request: Request) => Promise<Response>
  readonly graph: WebBootGraph
  /** Model-facing tools in the resolved desktop composition. */
  readonly toolNames: readonly string[]
  clientBundlePath(id: string): string | undefined
  stop(): Promise<void>
}

const DESKTOP_PATCH = fileURLToPath(new URL('../config/desktop.patch.yml', import.meta.url))

/** Boot the stock Web composition with its physical Web carrier replaced by Electron IPC. */
export async function startDesktopHost(
  permissionCap?: (cwd: string) => SubagentPermissionTier | undefined,
  environmentPolicy?: (cwd: string, environment: Readonly<NodeJS.ProcessEnv>) => NodeJS.ProcessEnv,
  localModelRoles?: () => LocalModelRoles,
  bareModuleBaseUrl = import.meta.url,
): Promise<DesktopHost> {
  const previousModuleBaseUrl = process.env.DSH_DESKTOP_MODULE_BASE_URL
  process.env.DSH_DESKTOP_MODULE_BASE_URL = bareModuleBaseUrl
  let ctx: Context
  try {
    ;({ ctx } = await runProfile({
      environment: loadLayeredEnv('dsh'),
      profile: 'web',
      patchFiles: [DESKTOP_PATCH],
      args: [],
      watchUserLayers: false,
      // The packaged Host owns the complete plugin set. Resolve bare configured
      // packages beside this installed module instead of from the writable profile.
      bareModuleBaseUrl,
    }))
  } finally {
    if (previousModuleBaseUrl === undefined) delete process.env.DSH_DESKTOP_MODULE_BASE_URL
    else process.env.DSH_DESKTOP_MODULE_BASE_URL = previousModuleBaseUrl
  }
  try {
    if (localModelRoles !== undefined) installLocalVisionRouting(ctx, localModelRoles)
    if (permissionCap !== undefined || environmentPolicy !== undefined) {
      const subagents = required(ctx, 'subagents') as {
        registerPermissionCeiling(
          ceiling: (request: { readonly cwd: string; readonly requested: SubagentPermissionTier }) => SubagentPermissionTier,
        ): () => void
        registerEnvironmentPolicy(
          policy: (request: { readonly cwd: string; readonly environment: Readonly<NodeJS.ProcessEnv> }) => NodeJS.ProcessEnv,
        ): () => void
      }
      if (permissionCap !== undefined) {
        subagents.registerPermissionCeiling(request => permissionCap(request.cwd) ?? request.requested)
      }
      if (environmentPolicy !== undefined) {
        subagents.registerEnvironmentPolicy(request => environmentPolicy(request.cwd, request.environment))
      }
    }
    const apiProxy = required(ctx, 'apiProxy') as Parameters<typeof toFetchHandler>[0]
    const connection = required(ctx, 'connection') as HostConnectionHandle
    const modules = required(ctx, 'clientModules') as ClientModuleRegistry
    const tools = required(ctx, 'tools') as { schemas(): readonly { readonly name: string }[] }
    const handler = connection.createLocalFetchHandler(toFetchHandler(apiProxy))
    return {
      fetch: request => handler.fetch(request),
      graph: nativeGraph(modules.graph()),
      toolNames: tools.schemas().map(tool => tool.name),
      clientBundlePath: id => modules.clientPath(id),
      stop: async () => { await ctx.fiber.dispose() },
    }
  } catch (error) {
    await ctx.fiber.dispose()
    throw error
  }
}

function required(ctx: Context, key: string): unknown {
  const value: unknown = ctx.get(key)
  if (value === undefined) throw new Error(`desktop: Host service ${JSON.stringify(key)} is unavailable`)
  return value
}

function nativeGraph(graph: WebBootGraph): WebBootGraph {
  return {
    rev: graph.rev,
    entries: graph.entries.map(entry => ({
      ...entry,
      url: `dsh-plugin://bundle/${encodeURIComponent(entry.id)}/client.js?rev=${encodeURIComponent(entry.rev)}`,
    })),
  }
}
