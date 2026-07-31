import { describe, expect, it } from 'vitest'
import {
  createToolOperationIdentity,
  ToolOperationJournal
} from './operation-journal.js'

describe('ToolOperationJournal', () => {
  it('includes turnId in the operation key so fallback call ids do not collide across turns', () => {
    const first = createToolOperationIdentity({
      threadId: 'thread-1',
      turnId: 'turn-1',
      callId: 'call_1',
      toolName: 'write_file',
      args: { path: 'a.md' }
    })
    const second = createToolOperationIdentity({
      threadId: 'thread-1',
      turnId: 'turn-2',
      callId: 'call_1',
      toolName: 'write_file',
      args: { path: 'a.md' }
    })

    expect(ToolOperationJournal.key(first)).not.toBe(ToolOperationJournal.key(second))
  })

  it('hashes arguments with stable object key ordering', () => {
    const left = createToolOperationIdentity({
      threadId: 'thread-1',
      turnId: 'turn-1',
      callId: 'call_1',
      toolName: 'tool',
      args: { b: 2, a: { y: true, x: 1 } }
    })
    const right = createToolOperationIdentity({
      threadId: 'thread-1',
      turnId: 'turn-1',
      callId: 'call_1',
      toolName: 'tool',
      args: { a: { x: 1, y: true }, b: 2 }
    })

    expect(left.argsHash).toBe(right.argsHash)
  })

  it('only replays completed records for the exact identity', () => {
    const journal = new ToolOperationJournal({ nowIso: () => '2026-01-01T00:00:00.000Z' })
    const identity = createToolOperationIdentity({
      threadId: 'thread-1',
      turnId: 'turn-1',
      callId: 'call_1',
      toolName: 'tool',
      args: { value: 1 }
    })
    const differentArgs = createToolOperationIdentity({
      threadId: 'thread-1',
      turnId: 'turn-1',
      callId: 'call_1',
      toolName: 'tool',
      args: { value: 2 }
    })

    journal.begin(identity)
    expect(journal.getCompleted(identity)).toBeNull()
    journal.complete(identity, { output: { ok: true } })

    expect(journal.getCompleted(identity)).toEqual({ output: { ok: true } })
    expect(journal.getCompleted(differentArgs)).toBeNull()
  })

  it('bounds resolved records while retaining in-progress operations', () => {
    const journal = new ToolOperationJournal({ resolvedCapacity: 2 })
    const operation = (callId: string) => createToolOperationIdentity({
      threadId: 'thread', turnId: 'turn', callId, toolName: 'write', args: { callId }
    })
    const first = operation('first')
    const second = operation('second')
    const third = operation('third')
    const active = operation('active')

    journal.complete(first, { output: 'first' })
    journal.complete(second, { output: 'second' })
    journal.begin(active)
    journal.complete(third, { output: 'third' })

    expect(journal.getCompleted(first)).toBeNull()
    expect(journal.getCompleted(second)).toEqual({ output: 'second' })
    expect(journal.getCompleted(third)).toEqual({ output: 'third' })
    expect(journal.get(active)?.status).toBe('started')
  })
})
