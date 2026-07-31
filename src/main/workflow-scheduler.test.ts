import { describe, expect, it, vi } from 'vitest'
import { WorkflowScheduler } from './workflow-scheduler'

describe('WorkflowScheduler', () => {
  it('starts once, ticks immediately and stops ownership of the timer', async () => {
    vi.useFakeTimers()
    const tick = vi.fn(async () => undefined)
    const scheduler = new WorkflowScheduler({ intervalMs: 100, tick })
    scheduler.start()
    scheduler.start()
    await Promise.resolve()
    expect(tick).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(200)
    expect(tick).toHaveBeenCalledTimes(3)
    scheduler.stop()
    await vi.advanceTimersByTimeAsync(200)
    expect(tick).toHaveBeenCalledTimes(3)
    expect(scheduler.isStarted()).toBe(false)
    vi.useRealTimers()
  })
})
