/**
 * Serializes the main process operations that can replace or reconfigure the
 * single managed Kun runtime. The coordinator owns concurrency only; callers
 * retain runtime policy and I/O.
 */
export class ManagedRuntimeOperationCoordinator<Settings> {
  private ensurePromise: Promise<Settings> | null = null
  private ensureFingerprint: string | null = null
  private restartPromise: Promise<void> | null = null
  private settingsApplyPromise: Promise<void> | null = null
  private queuedSettingsApply: {
    operation: () => Promise<void>
    onError: (error: unknown) => void
  } | null = null
  private latestSettings: Settings | null = null

  hasPendingOperation(): boolean {
    return Boolean(
      this.ensurePromise ||
      this.restartPromise ||
      this.settingsApplyPromise ||
      this.queuedSettingsApply
    )
  }

  latestOr(fallback: Settings): Settings {
    return this.latestSettings ?? fallback
  }

  noteLatest(settings: Settings): void {
    this.latestSettings = settings
  }

  async waitForRestart(): Promise<boolean> {
    const restart = this.restartPromise
    if (!restart) return false
    await restart
    return true
  }

  async ensure(fingerprint: string, operation: () => Promise<Settings>): Promise<Settings> {
    const pending = this.ensurePromise
    const pendingFingerprint = this.ensureFingerprint
    if (pending) {
      try {
        const result = await pending
        if (pendingFingerprint === fingerprint) return result
      } catch {
        // A caller with current settings gets one fresh attempt below.
      }
    }
    let tracked: Promise<Settings>
    tracked = operation().finally(() => {
      if (this.ensurePromise === tracked) {
        this.ensurePromise = null
        this.ensureFingerprint = null
      }
    })
    this.ensurePromise = tracked
    this.ensureFingerprint = fingerprint
    return tracked
  }

  restart(operation: () => Promise<void>): Promise<void> {
    if (this.restartPromise) return this.restartPromise
    let tracked: Promise<void>
    tracked = operation().finally(() => {
      if (this.restartPromise === tracked) this.restartPromise = null
    })
    this.restartPromise = tracked
    this.ensurePromise = null
    this.ensureFingerprint = null
    return tracked
  }

  enqueueSettingsApply(
    operation: () => Promise<void>,
    onError: (error: unknown) => void
  ): void {
    // Automatic settings saves can arrive much faster than Kun can apply
    // them. Keep the in-flight apply, but replace any not-yet-started apply
    // with the newest projection instead of replaying every intermediate edit.
    this.queuedSettingsApply = { operation, onError }
    this.startSettingsApplyDrain()
  }

  private startSettingsApplyDrain(): void {
    if (this.settingsApplyPromise || !this.queuedSettingsApply) return
    let tracked: Promise<void>
    tracked = this.drainSettingsApplies()
      .finally(() => {
        if (this.settingsApplyPromise === tracked) this.settingsApplyPromise = null
        // An enqueue can land after the drain's final empty check but before
        // this promise settles. Start another drain so that update is not lost.
        this.startSettingsApplyDrain()
      })
    this.settingsApplyPromise = tracked
  }

  private async drainSettingsApplies(): Promise<void> {
    while (this.queuedSettingsApply) {
      const next = this.queuedSettingsApply
      this.queuedSettingsApply = null
      try {
        await next.operation()
      } catch (error) {
        next.onError(error)
      }
    }
  }

  async waitForSettingsApply(): Promise<void> {
    while (this.settingsApplyPromise) await this.settingsApplyPromise
  }
}
