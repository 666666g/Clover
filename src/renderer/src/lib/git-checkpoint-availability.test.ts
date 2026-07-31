import { describe, expect, it } from 'vitest'
import { GitCheckpointAvailabilityCache } from './git-checkpoint-availability'

describe('GitCheckpointAvailabilityCache', () => {
  it('retries a workspace after the unavailable entry expires', () => {
    let now = 1_000
    const cache = new GitCheckpointAvailabilityCache({ retryAfterMs: 100, now: () => now })

    cache.markUnavailable('/workspace')
    expect(cache.canAttempt('/workspace')).toBe(false)

    now += 100
    expect(cache.canAttempt('/workspace')).toBe(true)
    expect(cache.size).toBe(0)
  })

  it('bounds unavailable workspaces and keeps recently used entries', () => {
    const cache = new GitCheckpointAvailabilityCache({ maxEntries: 2, now: () => 1_000 })

    cache.markUnavailable('/one')
    cache.markUnavailable('/two')
    expect(cache.canAttempt('/one')).toBe(false)
    cache.markUnavailable('/three')

    expect(cache.size).toBe(2)
    expect(cache.canAttempt('/two')).toBe(true)
    expect(cache.canAttempt('/one')).toBe(false)
    expect(cache.canAttempt('/three')).toBe(false)
  })
})
