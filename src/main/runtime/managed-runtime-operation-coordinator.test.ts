import { describe, expect, it, vi } from 'vitest'
import { ManagedRuntimeOperationCoordinator } from './managed-runtime-operation-coordinator'

describe('ManagedRuntimeOperationCoordinator', () => {
  it('shares ensures for one fingerprint and retries after a different fingerprint', async () => {
    const coordinator = new ManagedRuntimeOperationCoordinator<{ id: string }>()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const firstOperation = vi.fn(async () => {
      await gate
      return { id: 'first' }
    })
    const first = coordinator.ensure('a', firstOperation)
    const same = coordinator.ensure('a', firstOperation)
    release()
    expect(await same).toEqual({ id: 'first' })
    expect(await first).toEqual({ id: 'first' })
    expect(firstOperation).toHaveBeenCalledOnce()

    await expect(coordinator.ensure('b', async () => ({ id: 'second' }))).resolves.toEqual({ id: 'second' })
  })

  it('shares restart and invalidates an in-flight ensure owner', async () => {
    const coordinator = new ManagedRuntimeOperationCoordinator<string>()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const operation = vi.fn(() => gate)

    const first = coordinator.restart(operation)
    const second = coordinator.restart(operation)
    expect(second).toBe(first)
    release()
    await first
    expect(operation).toHaveBeenCalledOnce()
  })

  it('serializes settings applies and exposes the latest settings anchor', async () => {
    const coordinator = new ManagedRuntimeOperationCoordinator<{ value: number }>()
    const trace: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    coordinator.noteLatest({ value: 2 })
    coordinator.enqueueSettingsApply(async () => {
      trace.push('first-start')
      await gate
      trace.push('first-end')
    }, vi.fn())
    coordinator.enqueueSettingsApply(async () => {
      trace.push(`second:${coordinator.latestOr({ value: 0 }).value}`)
    }, vi.fn())

    await vi.waitFor(() => expect(trace).toEqual(['first-start']))
    release()
    await coordinator.waitForSettingsApply()
    expect(trace).toEqual(['first-start', 'first-end', 'second:2'])
    expect(coordinator.hasPendingOperation()).toBe(false)
  })

  it('keeps only the latest pending settings apply while one is running', async () => {
    const coordinator = new ManagedRuntimeOperationCoordinator<{ value: number }>()
    const trace: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })

    coordinator.enqueueSettingsApply(async () => {
      trace.push('first-start')
      await gate
      trace.push('first-end')
    }, vi.fn())
    await vi.waitFor(() => expect(trace).toEqual(['first-start']))

    coordinator.enqueueSettingsApply(async () => { trace.push('stale-second') }, vi.fn())
    coordinator.enqueueSettingsApply(async () => { trace.push('latest-third') }, vi.fn())
    release()

    await coordinator.waitForSettingsApply()
    expect(trace).toEqual(['first-start', 'first-end', 'latest-third'])
    expect(coordinator.hasPendingOperation()).toBe(false)
  })
})
