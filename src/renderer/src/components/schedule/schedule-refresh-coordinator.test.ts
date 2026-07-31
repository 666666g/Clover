import { describe, expect, it } from 'vitest'
import { createScheduleRefreshCoordinator } from './schedule-refresh-coordinator'

describe('schedule refresh coordinator', () => {
  it('accepts only the newest refresh and blocks polling during saves', () => {
    const coordinator = createScheduleRefreshCoordinator()
    const first = coordinator.beginRefresh()
    const second = coordinator.beginRefresh()
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(coordinator.isCurrent(first!)).toBe(false)
    expect(coordinator.isCurrent(second!)).toBe(true)

    const mutation = coordinator.beginMutation()
    expect(coordinator.beginRefresh()).toBeNull()
    expect(coordinator.isCurrent(mutation)).toBe(true)
    coordinator.endMutation()

    const afterMutation = coordinator.beginRefresh()
    expect(afterMutation).not.toBeNull()
    expect(coordinator.isCurrent(mutation)).toBe(false)
    coordinator.invalidate()
    expect(coordinator.isCurrent(afterMutation!)).toBe(false)
  })
})
