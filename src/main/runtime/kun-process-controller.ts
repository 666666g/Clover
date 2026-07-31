import type { ChildProcess } from 'node:child_process'

export type KunUnexpectedExitInfo = {
  code: number | null
  signal: NodeJS.Signals | null
  stderrTail: string
}

/**
 * Owns the mutable lifecycle state for the one GUI-managed Kun child.
 *
 * Process spawning, readiness, logging, and stop policy remain in their focused
 * adapters; this owner prevents those adapters from inventing independent module
 * globals or single-flight rules.
 */
export class KunProcessController<LogCapture> {
  child: ChildProcess | null = null
  childPort: number | null = null
  logCapture: LogCapture | null = null
  lastResolvedBinary: string | null = null
  stderrTail = ''

  private startPromise: Promise<void> | null = null
  private readonly intentionalStops = new WeakSet<ChildProcess>()
  private readonly readyChildren = new WeakSet<ChildProcess>()
  private unexpectedExitHandler: ((info: KunUnexpectedExitInfo) => void) | null = null

  isRunning(): boolean {
    return this.child !== null && this.child.exitCode === null && this.child.signalCode === null
  }

  isCurrentPid(pid: number): boolean {
    return Boolean(this.child?.pid === pid && this.isRunning())
  }

  setUnexpectedExitHandler(
    handler: ((info: KunUnexpectedExitInfo) => void) | null
  ): void {
    this.unexpectedExitHandler = handler
  }

  reportUnexpectedExit(info: KunUnexpectedExitInfo): void {
    this.unexpectedExitHandler?.(info)
  }

  markIntentionalStop(child: ChildProcess): void {
    this.intentionalStops.add(child)
  }

  markReady(child: ChildProcess): void {
    this.readyChildren.add(child)
  }

  shouldReportUnexpectedExit(child: ChildProcess): boolean {
    return this.readyChildren.has(child) && !this.intentionalStops.has(child)
  }

  waitForStartupSettled(): Promise<void> {
    return this.startPromise?.catch(() => undefined) ?? Promise.resolve()
  }

  start(factory: () => Promise<void>): Promise<void> {
    if (this.startPromise) return this.startPromise
    let promise: Promise<void>
    promise = Promise.resolve().then(factory).finally(() => {
      if (this.startPromise === promise) this.startPromise = null
    })
    this.startPromise = promise
    return promise
  }

  clearChild(expected: ChildProcess): boolean {
    if (this.child !== expected) return false
    this.child = null
    this.childPort = null
    return true
  }
}
