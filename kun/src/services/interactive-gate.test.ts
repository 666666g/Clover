import { describe, expect, it } from 'vitest'
import { awaitAbortableGate } from './interactive-gate.js'

describe('awaitAbortableGate', () => {
  it('continues to await a gate that was armed before publication', async () => {
    let resolvePending!: (value: 'allow') => void
    const pending = new Promise<'allow'>((resolve) => { resolvePending = resolve })
    const waiting = awaitAbortableGate(
      pending,
      new AbortController().signal,
      () => undefined,
      'aborted'
    )

    resolvePending('allow')

    await expect(waiting).resolves.toBe('allow')
  })

  it('cancels the armed gate when its turn aborts', async () => {
    const controller = new AbortController()
    let aborted = 0
    const waiting = awaitAbortableGate(
      new Promise<never>(() => undefined),
      controller.signal,
      () => { aborted += 1 },
      'aborted'
    )

    controller.abort()

    await expect(waiting).rejects.toThrow('aborted')
    expect(aborted).toBe(1)
  })
})
