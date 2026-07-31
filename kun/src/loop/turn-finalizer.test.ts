import { describe, expect, it, vi } from 'vitest'
import { TurnFinalizer } from './turn-finalizer.js'

describe('TurnFinalizer', () => {
  it('persists only the first concurrent terminal outcome', async () => {
    let release: (() => void) | undefined
    const finishTurn = vi.fn(async () => {
      await new Promise<void>((resolve) => { release = resolve })
      return { kind: 'applied' as const, status: 'failed' as const, error: 'deadline' }
    })
    const finalizer = new TurnFinalizer({ finishTurn, getTurn: vi.fn() } as never)
    const first = finalizer.settle({
      threadId: 'thread_1', turnId: 'turn_1', status: 'failed', error: 'deadline', code: 'timeout'
    })
    const second = finalizer.settle({
      threadId: 'thread_1', turnId: 'turn_1', status: 'completed'
    })

    expect(finishTurn).toHaveBeenCalledTimes(1)
    release?.()
    await expect(first).resolves.toEqual({
      kind: 'applied', status: 'failed', error: 'deadline'
    })
    await expect(second).resolves.toEqual({
      kind: 'applied', status: 'failed', error: 'deadline'
    })
  })

  it('allows one retry when terminal persistence itself fails', async () => {
    const finishTurn = vi.fn()
      .mockRejectedValueOnce(new Error('disk unavailable'))
      .mockResolvedValueOnce({ kind: 'applied', status: 'failed', error: 'failed' })
    const finalizer = new TurnFinalizer({
      finishTurn,
      getTurn: vi.fn().mockResolvedValue({ status: 'running' })
    } as never)
    const input = { threadId: 'thread_1', turnId: 'turn_1', status: 'failed' as const, error: 'failed' }

    await expect(finalizer.settle(input)).rejects.toThrow('disk unavailable')
    await expect(finalizer.settle(input)).resolves.toEqual({
      kind: 'applied', status: 'failed', error: 'failed'
    })
    expect(finishTurn).toHaveBeenCalledTimes(2)
  })

  it('reports the durable winner when another owner finalized first', async () => {
    const finalizer = new TurnFinalizer({
      finishTurn: vi.fn().mockResolvedValue({ kind: 'already_terminal', status: 'aborted' }),
      getTurn: vi.fn()
    } as never)

    await expect(finalizer.settle({
      threadId: 'thread_1', turnId: 'turn_1', status: 'completed'
    })).resolves.toEqual({ kind: 'already_terminal', status: 'aborted' })
  })
})
