/**
 * Owns the close callbacks for live SSE streams, grouped by thread. EventBus
 * subscriptions alone are not enough for deletion: removing a subscriber
 * stops future events but leaves the HTTP response and its heartbeat timer
 * alive. The thread lifecycle owns this registry so a successful DELETE can
 * actively terminate every response for that thread.
 */
export class ThreadEventStreamRegistry {
  private readonly closersByThread = new Map<string, Set<() => void>>()

  register(threadId: string, close: () => void): () => void {
    const closers = this.closersByThread.get(threadId) ?? new Set<() => void>()
    closers.add(close)
    this.closersByThread.set(threadId, closers)

    let removed = false
    return () => {
      if (removed) return
      removed = true
      closers.delete(close)
      if (closers.size === 0 && this.closersByThread.get(threadId) === closers) {
        this.closersByThread.delete(threadId)
      }
    }
  }

  closeThread(threadId: string): void {
    const closers = this.closersByThread.get(threadId)
    if (!closers) return
    // Remove the set before invoking callbacks. Each callback deregisters
    // itself, and a callback is allowed to synchronously close another stream.
    this.closersByThread.delete(threadId)
    for (const close of [...closers]) {
      try {
        close()
      } catch {
        // A broken response must not prevent the remaining deleted-thread
        // streams from being released.
      }
    }
  }

  closeAll(): void {
    for (const threadId of [...this.closersByThread.keys()]) {
      this.closeThread(threadId)
    }
  }
}
