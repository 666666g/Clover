import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileSessionStore } from '../src/adapters/file/file-session-store.js'
import { InMemorySessionStore } from '../src/adapters/in-memory-session-store.js'
import type { TurnItem } from '../src/contracts/items.js'
import { makeUserItem } from '../src/domain/item.js'
import type { SessionStore } from '../src/ports/session-store.js'
import { rewriteItemHistoryWithRetry } from '../src/services/history-commit-coordinator.js'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

function userItem(threadId: string, id: string, text: string): TurnItem {
  return makeUserItem({ id, threadId, turnId: 'turn_1', text })
}

async function expectStaleRewriteToConflict(store: SessionStore): Promise<void> {
  const threadId = 'thr_history_revision'
  await store.appendItem(threadId, userItem(threadId, 'item_first', 'first'))
  const snapshot = await store.loadItemSnapshot(threadId)
  await store.appendItem(threadId, userItem(threadId, 'item_late', 'late append'))

  await expect(store.rewriteItemsIfRevision(threadId, snapshot.revision, snapshot.items))
    .resolves.toMatchObject({ applied: false, reason: 'conflict' })
  await expect(store.loadItems(threadId)).resolves.toEqual([
    expect.objectContaining({ id: 'item_first', text: 'first' }),
    expect.objectContaining({ id: 'item_late', text: 'late append' })
  ])
}

describe('history commit coordinator', () => {
  it('rejects a stale in-memory full-history replacement without dropping the append', async () => {
    await expectStaleRewriteToConflict(new InMemorySessionStore())
  })

  it('rejects a stale file-backed full-history replacement without dropping the append', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-history-revision-'))
    cleanup.push(dataDir)
    await expectStaleRewriteToConflict(new FileSessionStore({ dataDir }))
  })

  it('rebuilds a pure replacement from the latest history after a conflict', async () => {
    const store = new InMemorySessionStore()
    const threadId = 'thr_history_retry'
    await store.appendItem(threadId, userItem(threadId, 'item_first', 'first'))
    let injectedConcurrentAppend = false

    const result = await rewriteItemHistoryWithRetry({
      sessionStore: store,
      threadId,
      maxAttempts: 2,
      build: async (snapshot, attempt) => {
        if (!injectedConcurrentAppend) {
          injectedConcurrentAppend = true
          await store.appendItem(threadId, userItem(threadId, 'item_late', 'late append'))
        }
        return {
          changed: true,
          items: [...snapshot.items, userItem(threadId, 'item_derived', `derived on attempt ${attempt}`)],
          value: attempt
        }
      }
    })

    expect(result).toMatchObject({ status: 'applied', attempts: 2, value: 2 })
    await expect(store.loadItems(threadId)).resolves.toEqual([
      expect.objectContaining({ id: 'item_first', text: 'first' }),
      expect.objectContaining({ id: 'item_late', text: 'late append' }),
      expect.objectContaining({ id: 'item_derived', text: 'derived on attempt 2' })
    ])
  })
})
