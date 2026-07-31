import type { TurnItem } from '../contracts/items.js'
import type { ItemHistorySnapshot, SessionStore } from '../ports/session-store.js'

/** A pure replacement derived from one immutable item-history snapshot. */
export type ItemHistoryRewritePlan<T> = {
  changed: boolean
  items: TurnItem[]
  value: T
}

export type ItemHistoryRewriteResult<T> =
  | {
      status: 'applied' | 'unchanged'
      attempts: number
      items: TurnItem[]
      revision: number
      value: T
    }
  | {
      status: 'conflict' | 'closed'
      attempts: number
      items: TurnItem[]
      revision?: number
    }

/**
 * Runs a read-compute-conditional-rewrite flow without holding a SessionStore
 * write queue while `build` runs. This is important for model-backed
 * compaction: append/update operations remain free to progress, and a stale
 * replacement is retried from a newer history instead of overwriting them.
 */
export async function rewriteItemHistoryWithRetry<T>(input: {
  sessionStore: SessionStore
  threadId: string
  maxAttempts?: number
  build: (
    snapshot: ItemHistorySnapshot,
    attempt: number
  ) => Promise<ItemHistoryRewritePlan<T>> | ItemHistoryRewritePlan<T>
}): Promise<ItemHistoryRewriteResult<T>> {
  const maxAttempts = Math.max(1, Math.floor(input.maxAttempts ?? 2))
  let latest: ItemHistorySnapshot | undefined
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const snapshot = await input.sessionStore.loadItemSnapshot(input.threadId)
    latest = snapshot
    const plan = await input.build({
      revision: snapshot.revision,
      items: [...snapshot.items]
    }, attempt)
    if (!plan.changed) {
      return {
        status: 'unchanged',
        attempts: attempt,
        items: [...snapshot.items],
        revision: snapshot.revision,
        value: plan.value
      }
    }
    const committed = await input.sessionStore.rewriteItemsIfRevision(
      input.threadId,
      snapshot.revision,
      [...plan.items]
    )
    if (committed.applied) {
      return {
        status: 'applied',
        attempts: attempt,
        items: [...plan.items],
        revision: committed.revision,
        value: plan.value
      }
    }
    if (committed.reason === 'closed') {
      return {
        status: 'closed',
        attempts: attempt,
        items: [...snapshot.items],
        ...(committed.revision !== undefined ? { revision: committed.revision } : {})
      }
    }
  }
  return {
    status: 'conflict',
    attempts: maxAttempts,
    items: [...(latest?.items ?? [])],
    ...(latest ? { revision: latest.revision } : {})
  }
}
