import type { ThreadStore } from '../ports/thread-store.js'

/**
 * Serializes read-modify-write operations for one thread record across every
 * service that shares a ThreadStore. A TurnService-local queue is insufficient:
 * title generation, goal accounting, and HTTP thread updates can otherwise
 * each read the same snapshot and overwrite fields written by another service.
 */
const queuesByStore = new WeakMap<ThreadStore, Map<string, Promise<void>>>()

export async function withThreadStoreMutation<T>(
  threadStore: ThreadStore,
  threadId: string,
  operation: () => Promise<T>
): Promise<T> {
  let queues = queuesByStore.get(threadStore)
  if (!queues) {
    queues = new Map()
    queuesByStore.set(threadStore, queues)
  }
  const previous = queues.get(threadId) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(operation)
  const guard = run.then(() => undefined, () => undefined)
  queues.set(threadId, guard)
  try {
    return await run
  } finally {
    if (queues.get(threadId) === guard) {
      queues.delete(threadId)
      if (queues.size === 0) queuesByStore.delete(threadStore)
    }
  }
}
