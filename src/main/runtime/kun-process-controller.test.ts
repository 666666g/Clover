import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { KunProcessController } from './kun-process-controller'

function child(pid = 1): ChildProcess {
  return Object.assign(new EventEmitter(), {
    pid,
    exitCode: null,
    signalCode: null
  }) as unknown as ChildProcess
}

describe('KunProcessController', () => {
  it('shares one in-flight startup and permits a later fresh startup', async () => {
    const controller = new KunProcessController<never>()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const factory = vi.fn(() => gate)

    const first = controller.start(factory)
    const second = controller.start(factory)
    expect(second).toBe(first)
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1))

    release()
    await first
    await controller.start(async () => undefined)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('reports only ready children that were not intentionally stopped', () => {
    const controller = new KunProcessController<never>()
    const handler = vi.fn()
    const crashed = child(1)
    const stopped = child(2)
    controller.setUnexpectedExitHandler(handler)
    controller.markReady(crashed)
    controller.markReady(stopped)
    controller.markIntentionalStop(stopped)

    expect(controller.shouldReportUnexpectedExit(crashed)).toBe(true)
    expect(controller.shouldReportUnexpectedExit(stopped)).toBe(false)
    controller.reportUnexpectedExit({ code: 1, signal: null, stderrTail: 'failed' })
    expect(handler).toHaveBeenCalledOnce()
  })

  it('clears only the child instance that still owns the controller', () => {
    const controller = new KunProcessController<never>()
    const current = child(1)
    const stale = child(2)
    controller.child = current
    controller.childPort = 18899

    expect(controller.clearChild(stale)).toBe(false)
    expect(controller.child).toBe(current)
    expect(controller.clearChild(current)).toBe(true)
    expect(controller.child).toBeNull()
    expect(controller.childPort).toBeNull()
  })
})
