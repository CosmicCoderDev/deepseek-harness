/** Structured-clone-only contract between the desktop preload and main process. */

export interface DesktopFetchRequest {
  readonly id: string
  readonly url: string
  readonly method: string
  readonly headers: readonly [string, string][]
  readonly body?: string
}

export interface DesktopFetchResponse {
  readonly status: number
  readonly headers: readonly [string, string][]
  readonly body?: Uint8Array
  readonly stream: boolean
}

export type DesktopStreamEvent =
  | { readonly type: 'chunk'; readonly data: Uint8Array }
  | { readonly type: 'end' }
  | { readonly type: 'error'; readonly message: string }

export const IPC_FETCH = 'dsh:fetch'
export const IPC_ABORT = 'dsh:abort'
export const IPC_STREAM = 'dsh:stream'
export const IPC_BOOT = 'dsh:boot'
export const IPC_SETTINGS_GET = 'dsh:settings:get'
export const IPC_SETTINGS_SAVE = 'dsh:settings:save'
export const IPC_SETTINGS_TEST = 'dsh:settings:test'
export const IPC_SETTINGS_COPY_DIAGNOSTICS = 'dsh:settings:copy-diagnostics'
export const IPC_SETTINGS_OPEN_LOGS = 'dsh:settings:open-logs'
export const IPC_SETTINGS_LOGIN = 'dsh:settings:login'
export const IPC_SETTINGS_REFRESH_STATUS = 'dsh:settings:refresh-status'
export const IPC_SETTINGS_RESTART_HOST = 'dsh:settings:restart-host'
export const IPC_SETTINGS_STATUS_CHANGED = 'dsh:settings:status-changed'
export const IPC_PROJECT_POLICY_SELECT = 'dsh:project-policy:select'
export const IPC_PROJECT_POLICY_GET = 'dsh:project-policy:get'
export const IPC_PROJECT_POLICY_SAVE = 'dsh:project-policy:save'
export const IPC_PROJECT_POLICY_DELETE = 'dsh:project-policy:delete'
export const IPC_PROJECT_POLICY_RESOLVE = 'dsh:project-policy:resolve'

export interface DesktopProjectPolicyResolution {
  readonly executionMode: DesktopProjectPolicyValue['defaultExecutionMode']
}

export type DesktopSubagentProduct = 'codex' | 'claude'

export interface DesktopProviderView {
  readonly id: DesktopSubagentProduct
  readonly displayName: string
  readonly capabilities: readonly string[]
  readonly supported: boolean
  readonly status: { readonly installed: boolean; readonly authenticated: boolean; readonly detail: string }
}

export interface DesktopSettingsView {
  readonly settings: {
    readonly version: 1
    readonly proxy: { readonly mode: 'system' | 'manual' | 'direct'; readonly url?: string }
    readonly subagentPermission: 'read-only' | 'project-development' | 'full-access'
  }
  readonly proxySummary: string
  readonly codex: { readonly installed: boolean; readonly authenticated: boolean; readonly detail: string }
  readonly claude: { readonly installed: boolean; readonly authenticated: boolean; readonly detail: string }
  readonly providers: readonly DesktopProviderView[]
  readonly statusCheckedAt: string
  readonly restartRequired: boolean
  readonly recoveryWarning?: string
}

export interface DesktopProjectPolicyValue {
  readonly version: 1
  readonly projectRoot: string
  readonly defaultExecutionMode: 'local-only' | 'auto-select' | 'codex-claude' | 'codex-direct' | 'claude-direct' | 'codex-claude-review'
  readonly defaultProvider?: string
  readonly defaultModel?: string
  readonly permissionCap: 'read-only' | 'project-development' | 'full-access'
  readonly network: 'inherit' | 'allow' | 'deny'
  readonly proxy: { readonly mode: 'inherit' | 'system' | 'direct' } | { readonly mode: 'manual'; readonly url: string }
  readonly crossReview: boolean
  readonly readRoots: readonly string[]
  readonly writeRoots: readonly string[]
}

export interface DesktopProjectPolicyView {
  readonly configured: boolean
  readonly policy: DesktopProjectPolicyValue
  readonly recoveryWarning?: string
}
