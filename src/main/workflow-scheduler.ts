export type WorkflowSchedulerOptions = {
  intervalMs: number
  tick: () => Promise<void>
}

/** Owns scheduler timer lifecycle; workflow policy remains in the runtime facade. */
export class WorkflowScheduler {
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly options: WorkflowSchedulerOptions) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.options.tick(), this.options.intervalMs)
    this.timer.unref?.()
    void this.options.tick()
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  isStarted(): boolean {
    return this.timer !== null
  }
}
