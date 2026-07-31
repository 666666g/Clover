export const DEFAULT_GIT_CHECKPOINT_RETRY_AFTER_MS = 5 * 60_000
export const DEFAULT_GIT_CHECKPOINT_UNAVAILABLE_CACHE_LIMIT = 128

type GitCheckpointAvailabilityCacheOptions = {
  retryAfterMs?: number
  maxEntries?: number
  now?: () => number
}

/**
 * Temporarily suppresses checkpoint attempts after the host reports that Git
 * is unavailable. Entries expire so installing/fixing Git can recover without
 * restarting Kun, and the LRU bound prevents workspace churn from growing a
 * renderer-process singleton forever.
 */
export class GitCheckpointAvailabilityCache {
  private readonly unavailableAt = new Map<string, number>()
  private readonly retryAfterMs: number
  private readonly maxEntries: number
  private readonly now: () => number

  constructor(options: GitCheckpointAvailabilityCacheOptions = {}) {
    this.retryAfterMs = Math.max(1, options.retryAfterMs ?? DEFAULT_GIT_CHECKPOINT_RETRY_AFTER_MS)
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_GIT_CHECKPOINT_UNAVAILABLE_CACHE_LIMIT)
    this.now = options.now ?? Date.now
  }

  canAttempt(workspaceKey: string): boolean {
    const unavailableAt = this.unavailableAt.get(workspaceKey)
    if (unavailableAt === undefined) return true
    if (this.now() - unavailableAt >= this.retryAfterMs) {
      this.unavailableAt.delete(workspaceKey)
      return true
    }
    this.unavailableAt.delete(workspaceKey)
    this.unavailableAt.set(workspaceKey, unavailableAt)
    return false
  }

  markUnavailable(workspaceKey: string): void {
    this.unavailableAt.delete(workspaceKey)
    this.unavailableAt.set(workspaceKey, this.now())
    while (this.unavailableAt.size > this.maxEntries) {
      const oldest = this.unavailableAt.keys().next().value
      if (oldest === undefined) break
      this.unavailableAt.delete(oldest)
    }
  }

  clear(workspaceKey?: string): void {
    if (workspaceKey === undefined) this.unavailableAt.clear()
    else this.unavailableAt.delete(workspaceKey)
  }

  get size(): number {
    return this.unavailableAt.size
  }
}
