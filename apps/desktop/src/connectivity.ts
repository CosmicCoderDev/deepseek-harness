/** Credential-free connectivity checks for desktop provider endpoints. */

import { execFile } from 'node:child_process'
import { desktopSubagentProviders } from './subagent-provider-registry.ts'

export interface ConnectivityResult {
  readonly service: string
  readonly ok: boolean
  readonly detail: string
}

const ENDPOINTS = [
  ['DeepSeek', 'https://api.deepseek.com/v1/models'],
  ['Ollama', 'http://127.0.0.1:11434/api/tags'],
] as const

/** Check public service reachability without sending prompts or credentials. */
export async function testProviderConnectivity(environment: NodeJS.ProcessEnv = process.env): Promise<readonly ConnectivityResult[]> {
  const providers = desktopSubagentProviders.list().map(provider => [provider.displayName, provider.connectivityUrl] as const)
  return await Promise.all([...providers, ...ENDPOINTS].map(async ([service, url]) => await testEndpoint(service, url, environment)))
}

/** Format connectivity results for a native status dialog. */
export function formatConnectivityResults(results: readonly ConnectivityResult[]): string {
  return results.map(result => `${result.ok ? '✓' : '✗'} ${result.service}: ${result.detail}`).join('\n')
}

async function testEndpoint(service: string, url: string, environment: NodeJS.ProcessEnv): Promise<ConnectivityResult> {
  return await new Promise((resolve) => {
    execFile('/usr/bin/curl', [
      '--silent', '--show-error', '--output', '/dev/null', '--max-time', '8',
      '--noproxy', 'localhost,127.0.0.1,::1,*.local', '--write-out', '%{http_code}', url,
    ], { env: environment, timeout: 10_000 }, (error, stdout, stderr) => {
      const code = stdout.trim()
      if (code !== '' && code !== '000') {
        resolve({ service, ok: true, detail: `可连接（HTTP ${code}）` })
        return
      }
      const detail = error?.message.includes('timed out') === true
        ? '连接超时'
        : stderr.trim().replace(/\s+/gu, ' ').slice(0, 160) || '无法连接'
      resolve({ service, ok: false, detail })
    })
  })
}
