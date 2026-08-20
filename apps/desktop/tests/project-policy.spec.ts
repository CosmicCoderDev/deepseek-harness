import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  defaultProjectPolicy,
  projectExecutionMode,
  readProjectPolicies,
  resolveProjectPermissionCap,
  validateProjectPolicy,
  writeProjectPolicies,
  type DesktopProjectPolicy,
} from '../src/project-policy.ts'

function policy(root: string): DesktopProjectPolicy {
  return {
    version: 1,
    projectRoot: root,
    defaultExecutionMode: 'local-only',
    permissionCap: 'read-only',
    network: 'deny',
    proxy: { mode: 'inherit' },
    crossReview: false,
    readRoots: [root],
    writeRoots: [],
  }
}

describe('desktop project policies', () => {
  it('creates an inactive least-authority draft', () => {
    expect(defaultProjectPolicy('/workspace/project')).toEqual(policy('/workspace/project'))
  })

  it('validates a least-authority project policy', () => {
    expect(validateProjectPolicy(policy('/workspace/project'))).toEqual(policy('/workspace/project'))
  })

  it('forces offline projects local and resolves cross-review projects to the formal workflow', () => {
    expect(projectExecutionMode({ ...policy('/workspace/project'), defaultExecutionMode: 'codex-direct' })).toBe('local-only')
    expect(projectExecutionMode({
      ...policy('/workspace/project'),
      network: 'allow',
      defaultExecutionMode: 'codex-direct',
      crossReview: true,
    })).toBe('codex-claude-review')
  })

  it('resolves the most specific permission cap for a task working directory', () => {
    const root = { ...policy('/workspace'), permissionCap: 'project-development' as const }
    const nested = { ...policy('/workspace/restricted'), permissionCap: 'read-only' as const }
    const policies = new Map<string, DesktopProjectPolicy>([
      [root.projectRoot, root],
      [nested.projectRoot, nested],
    ])

    expect(resolveProjectPermissionCap(policies, '/workspace/source')).toBe('project-development')
    expect(resolveProjectPermissionCap(policies, '/workspace/restricted/source')).toBe('read-only')
    expect(resolveProjectPermissionCap(policies, '/unconfigured')).toBeUndefined()
  })

  it('rejects credentials and write roots outside the read boundary', () => {
    expect(() => validateProjectPolicy({
      ...policy('/workspace/project'),
      proxy: { mode: 'manual', url: 'http://name:secret@127.0.0.1:7897' },
    })).toThrow('凭据')
    expect(() => validateProjectPolicy({
      ...policy('/workspace/project'),
      writeRoots: ['/outside'],
    })).toThrow('写入边界')
  })

  it('round-trips policies through the private versioned store', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-project-policy-'))
    try {
      const source = policy('/workspace/project')
      await writeProjectPolicies(home, new Map([[source.projectRoot, source]]))
      const result = await readProjectPolicies(home)
      expect([...result.policies.values()]).toEqual([source])
      expect(JSON.parse(await readFile(join(home, 'desktop-project-policies.json'), 'utf8'))).toEqual({
        version: 1,
        projects: { [source.projectRoot]: source },
      })
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('preserves a corrupt store and disables all project overrides', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-project-policy-corrupt-'))
    try {
      await writeFile(join(home, 'desktop-project-policies.json'), '{bad-json}\n')
      const result = await readProjectPolicies(home)
      expect(result.policies.size).toBe(0)
      expect(result.recoveryWarning).toContain('停用全部项目覆盖')
      expect(await readFile(result.recoveredFile!, 'utf8')).toBe('{bad-json}\n')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})
