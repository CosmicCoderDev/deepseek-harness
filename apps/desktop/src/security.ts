/** Pure validation for values that cross the Electron renderer boundary. */

import type { DesktopFetchRequest } from './ipc-contract.ts'

export const INTERNAL_ORIGIN = 'http://dsh.internal'
export const MAX_BODY_BYTES = 160 * 1024 * 1024

const REQUEST_ID = /^[A-Za-z0-9-]{8,80}$/u

/** Allow the desktop shell to hand only ordinary browser destinations to the OS. */
export function isSafeExternalUrl(value: string): boolean {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

/** Validate one Fetch-shaped request before the main process dispatches it. */
export function parseDesktopFetchRequest(
  value: unknown,
  maxBodyBytes = MAX_BODY_BYTES,
): DesktopFetchRequest {
  if (typeof value !== 'object' || value === null) throw new Error('desktop: malformed IPC request')
  const request = value as Partial<DesktopFetchRequest>
  if (typeof request.id !== 'string' || !REQUEST_ID.test(request.id)
    || typeof request.url !== 'string' || typeof request.method !== 'string'
    || !Array.isArray(request.headers)
    || (request.body !== undefined && typeof request.body !== 'string')) {
    throw new Error('desktop: malformed IPC request')
  }
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    throw new Error('desktop: malformed IPC request URL')
  }
  if (url.origin !== INTERNAL_ORIGIN || !['GET', 'POST'].includes(request.method)) {
    throw new Error('desktop: rejected IPC request target')
  }
  if (request.body !== undefined && Buffer.byteLength(request.body) > maxBodyBytes) {
    throw new Error('desktop: IPC request body exceeds the configured limit')
  }
  for (const header of request.headers) {
    if (!Array.isArray(header) || header.length !== 2
      || typeof header[0] !== 'string' || typeof header[1] !== 'string') {
      throw new Error('desktop: malformed IPC request headers')
    }
  }
  return request as DesktopFetchRequest
}

/** Resolve only manifest-addressed JavaScript or source-map plugin resources. */
export function parsePluginBundleUrl(value: string): { id: string; sourceMap: boolean } | undefined {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  if (url.protocol !== 'dsh-plugin:' || url.hostname !== 'bundle') return undefined
  const match = /^\/([^/]+)\/client\.js(\.map)?$/u.exec(url.pathname)
  if (match?.[1] === undefined) return undefined
  try {
    return { id: decodeURIComponent(match[1]), sourceMap: match[2] !== undefined }
  } catch {
    return undefined
  }
}
