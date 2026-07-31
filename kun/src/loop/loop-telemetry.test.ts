import { describe, expect, it, vi } from 'vitest'
import type { SessionStore } from '../ports/session-store.js'
import { LoopTelemetry } from './loop-telemetry.js'

describe('LoopTelemetry', () => {
  it('hydrates the latest positive persisted prompt pressure only once', async () => {
    const loadUsageRecords = vi.fn().mockResolvedValue([
      { threadId: 'thread_1', model: 'older', usage: { promptTokens: 10 } },
      { threadId: 'thread_1', model: '', usage: { promptTokens: 30 } },
      { threadId: 'other', model: 'other', usage: { promptTokens: 100 } }
    ])
    const telemetry = new LoopTelemetry({ loadUsageRecords } as unknown as SessionStore)

    await telemetry.hydratePromptPressureIfCold('thread_1', 'fallback')

    expect(telemetry.consumePromptPressure('thread_1', 'fallback')).toEqual({
      model: 'fallback',
      promptTokens: 30
    })
    await telemetry.hydratePromptPressureIfCold('thread_1', 'fallback')
    expect(loadUsageRecords).toHaveBeenCalledTimes(1)
  })

  it('keeps the highest prompt pressure seen before compaction consumes it', () => {
    const telemetry = new LoopTelemetry({} as unknown as SessionStore)

    telemetry.recordPromptPressure('thread_1', 'first', 20)
    telemetry.recordPromptPressure('thread_1', 'smaller', 10)
    telemetry.recordPromptPressure('thread_1', 'largest', 30)

    expect(telemetry.consumePromptPressure('thread_1', 'fallback')).toEqual({
      model: 'largest',
      promptTokens: 30
    })
    expect(telemetry.consumePromptPressure('thread_1', 'fallback')).toBeUndefined()
  })

  it('classifies additive and breaking tool catalog changes without persistence side effects', () => {
    const telemetry = new LoopTelemetry({} as unknown as SessionStore)
    const base = {
      threadId: 'thread_1',
      workspace: '/workspace',
      mode: 'agent',
      model: 'model',
      activeSkillIds: [],
      fingerprint: 'first',
      toolNames: ['read'],
      toolHashes: { read: 'hash_read' }
    }

    expect(telemetry.recordToolCatalogFingerprint(base)).toEqual({ kind: 'none' })
    expect(telemetry.recordToolCatalogFingerprint({
      ...base,
      fingerprint: 'additive',
      toolNames: ['read', 'grep'],
      toolHashes: { read: 'hash_read', grep: 'hash_grep' }
    })).toMatchObject({ kind: 'additive' })
    expect(telemetry.recordToolCatalogFingerprint({
      ...base,
      fingerprint: 'breaking',
      toolHashes: { read: 'mutated' }
    })).toMatchObject({ kind: 'breaking' })
  })
})
