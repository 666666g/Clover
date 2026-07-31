/**
 * Await a gate that has already been registered with its external resolver.
 * Registering before publishing the corresponding SSE event is important: a
 * renderer may submit a decision synchronously while handling that event.
 */
export function awaitAbortableGate<T>(
  pending: Promise<T>,
  signal: AbortSignal,
  onAbort: () => void,
  abortMessage: string
): Promise<T> {
  if (signal.aborted) {
    onAbort()
    return Promise.reject(new Error(abortMessage))
  }
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort)
    const abort = () => {
      cleanup()
      onAbort()
      reject(new Error(abortMessage))
    }
    signal.addEventListener('abort', abort, { once: true })
    pending.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      }
    )
  })
}
