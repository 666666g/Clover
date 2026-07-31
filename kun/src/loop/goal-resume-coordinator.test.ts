import { describe, expect, it } from 'vitest'
import { GoalResumeCoordinator, type GoalResumeTimer } from './goal-resume-coordinator.js'

describe('GoalResumeCoordinator', () => {
  it('defers a capacity-blocked launch without consuming the goal retry budget', async () => {
    const scheduled: Array<{ callback: () => void; delayMs: number; cancelled: boolean }> = []
    let launches = 0
    const coordinator = new GoalResumeCoordinator({
      launch: async () => { launches += 1 },
      getActiveGoalKey: async () => 'goal-1',
      isThreadBusy: async () => false,
      baseDelayMs: 25,
      setTimer: (callback, delayMs): GoalResumeTimer => {
        const timer = { callback, delayMs, cancelled: false }
        scheduled.push(timer)
        return { cancel: () => { timer.cancelled = true } }
      }
    })

    expect(coordinator.noteGoalTurnSettled({
      threadId: 'thread-1',
      goalKey: 'goal-1',
      madeProgress: true
    })).toBe('scheduled')
    const initialTimer = scheduled[0]

    coordinator.defer('thread-1')

    expect(initialTimer.cancelled).toBe(true)
    expect(scheduled).toHaveLength(2)
    expect(scheduled[1].delayMs).toBe(25)
    scheduled[1].callback()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(launches).toBe(1)
  })
})
