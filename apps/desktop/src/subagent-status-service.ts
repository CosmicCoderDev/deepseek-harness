/** Cached, non-reentrant status inspection for packaged product CLIs. */

import type { SubagentStatus } from './subagent-status.ts'

export interface SubagentStatusSnapshot {
  readonly status: SubagentStatus
  readonly checkedAt: string
}

export class SubagentStatusService {
  private current: SubagentStatusSnapshot | undefined
  private pending: Promise<SubagentStatusSnapshot> | undefined

  constructor(
    private readonly inspect: () => Promise<SubagentStatus>,
    private readonly onChange: (snapshot: SubagentStatusSnapshot) => void = () => {},
    private readonly now: () => Date = () => new Date(),
  ) {}

  snapshot(): SubagentStatusSnapshot | undefined {
    return this.current
  }

  async get(): Promise<SubagentStatusSnapshot> {
    return this.current ?? await this.refresh()
  }

  async refresh(): Promise<SubagentStatusSnapshot> {
    if (this.pending !== undefined) return await this.pending
    this.pending = this.inspect().then((status) => {
      const snapshot = { status, checkedAt: this.now().toISOString() }
      this.current = snapshot
      this.onChange(snapshot)
      return snapshot
    }).finally(() => { this.pending = undefined })
    return await this.pending
  }
}
