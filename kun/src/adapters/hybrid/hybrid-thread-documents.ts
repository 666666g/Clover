import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { ThreadRecord } from '../../contracts/threads.js'
import { ThreadSchema } from '../../contracts/threads.js'
import type { TurnItem } from '../../contracts/items.js'
import { readJsonl } from '../file/file-thread-store.js'
import {
  hydrateThreadItems,
  normalizeThreadMetadata,
  type ThreadMetadataLine
} from './hybrid-thread-projection.js'

const THREAD_RECORD_CACHE_LIMIT = 128

/** Owns canonical JSONL/legacy reads, recovery precedence, and record caching. */
export class HybridThreadDocumentRepository {
  private readonly dataDir: string
  private readonly cache = new Map<string, { metadataSig: string; itemsSig: string; record: ThreadRecord }>()

  constructor(dataDir: string) {
    this.dataDir = resolve(dataDir, 'threads')
  }

  invalidate(threadId: string): void { this.cache.delete(threadId) }
  threadDir(threadId: string): string { return join(this.dataDir, threadId) }
  metadataPath(threadId: string): string { return join(this.threadDir(threadId), 'metadata.jsonl') }
  legacyThreadPath(threadId: string): string { return join(this.threadDir(threadId), 'thread.json') }
  messagesPath(threadId: string): string { return join(this.threadDir(threadId), 'messages.jsonl') }
  eventsPath(threadId: string): string { return join(this.threadDir(threadId), 'events.jsonl') }

  async readThread(threadId: string): Promise<ThreadRecord | null> {
    const [metadataSig, itemsSig] = await Promise.all([
      fileSignature(this.metadataPath(threadId)), fileSignature(this.messagesPath(threadId))
    ])
    const cached = this.cache.get(threadId)
    if (cached && cached.metadataSig === metadataSig && cached.itemsSig === itemsSig) {
      this.cache.delete(threadId)
      this.cache.set(threadId, cached)
      return cached.record
    }
    const metadata = await this.readLatestMetadata(threadId)
    const legacy = metadata ? null : await this.readLegacyThread(threadId)
    const source = metadata ?? legacy
    if (!source) return null
    const record = hydrateThreadItems(source, await this.loadItems(threadId), {
      preserveExistingItemsWhenNoFileItems: Boolean(legacy)
    })
    this.cache.set(threadId, { metadataSig, itemsSig, record })
    while (this.cache.size > THREAD_RECORD_CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!)
    return record
  }

  async readLatestMetadata(threadId: string): Promise<ThreadRecord | null> {
    const entries = await readJsonl<ThreadMetadataLine>(this.metadataPath(threadId))
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]
      if (entry?.kind !== 'thread_metadata' || entry.thread?.id !== threadId) continue
      const parsed = ThreadSchema.safeParse(entry.thread)
      if (parsed.success) return normalizeThreadMetadata(parsed.data, entries.slice(0, index + 1))
    }
    return null
  }

  private async readLegacyThread(threadId: string): Promise<ThreadRecord | null> {
    try {
      const parsed = ThreadSchema.safeParse(JSON.parse(await readFile(this.legacyThreadPath(threadId), 'utf-8')))
      return parsed.success ? parsed.data : null
    } catch { return null }
  }

  private async loadItems(threadId: string): Promise<TurnItem[]> {
    const raw = await readJsonl<TurnItem>(this.messagesPath(threadId))
    const latestById = new Map(raw.map((item) => [item.id, item]))
    const seen = new Set<string>()
    const ordered: TurnItem[] = []
    for (let index = raw.length - 1; index >= 0; index -= 1) {
      const item = raw[index]
      if (!item || seen.has(item.id)) continue
      seen.add(item.id)
      ordered.push(latestById.get(item.id)!)
    }
    return ordered.reverse()
  }
}

async function fileSignature(path: string): Promise<string> {
  try {
    const info = await stat(path)
    return `${info.size}:${info.mtimeMs}`
  } catch { return 'missing' }
}
