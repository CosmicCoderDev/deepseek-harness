/** In-process Harness Host composition for the native desktop carrier. */

import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { ClientModuleRegistry, WebBootGraph } from '@deepseek-ai/dsh-client-modules'

/** Ready in-process Host and the local assets selected by its client graph. */
export interface DesktopHost {
  readonly fetch: (request: Request) => Promise<Response>
  readonly graph: WebBootGraph
  clientBundlePath(id: string): string | undefined
  stop(): Promise<void>
}

const DESKTOP_PATCH = fileURLToPath(new URL('../config/desktop.patch.yml', import.meta.url))

/** Boot the stock Web composition with its physical Web carrier replaced by Electron IPC. */
export async function startDesktopHost(): Promise<DesktopHost> {
  const { ctx } = await runProfile({
    environment: loadLayeredEnv('dsh'),
    profile: 'web',
    patchFiles: [DESKTOP_PATCH],
    args: [],
    watchUserLayers: false,
  })
  try {
    const apiProxy = required(ctx, 'apiProxy') as Parameters<typeof toFetchHandler>[0]
    const connection = required(ctx, 'connection') as HostConnectionHandle
    const modules = required(ctx, 'clientModules') as ClientModuleRegistry
    const handler = connection.createLocalFetchHandler(toFetchHandler(apiProxy))
    return {
      fetch: request => handler.fetch(request),
      graph: nativeGraph(modules.graph()),
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
