import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ModelRequestTracePage,
  ModelRequestTraceRecord
} from '../../agent/model-request-traces'

const fetchPage = vi.hoisted(() => vi.fn())

vi.mock('../../agent/model-request-traces', async () => {
  const actual = await vi.importActual<typeof import('../../agent/model-request-traces')>(
    '../../agent/model-request-traces'
  )
  return { ...actual, fetchModelRequestTracePage: fetchPage }
})

import {
  mergeModelRequestTraceRecords,
  useModelRequestTraces,
  type ModelRequestTraceViewState
} from './useModelRequestTraces'

function trace(id: string, sequence: number, startedAt: string): ModelRequestTraceRecord {
  return {
    schemaVersion: 1,
    id,
    sequence,
    threadId: 'thread',
    turnId: 'turn',
    provider: 'deepseek',
    model: 'deepseek-chat',
    endpointFormat: 'openai-chat',
    attempt: 1,
    attemptReason: 'initial',
    status: 'completed',
    startedAt,
    request: {
      method: 'POST',
      url: 'https://api.deepseek.com/chat/completions',
      urlRedacted: false,
      headers: { values: {}, redactedNames: [] },
      body: { text: '{}', capturedBytes: 2, originalBytes: 2, truncated: false }
    }
  }
}

function page(records: ModelRequestTraceRecord[]): ModelRequestTracePage {
  return {
    schemaVersion: 1,
    records,
    activeCount: records.filter((record) => record.status === 'pending').length,
    limits: { maxRequestBodyBytes: 1024, maxResponseBodyBytes: 1024, maxPageSize: 200 },
    warnings: []
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

let exposed: ModelRequestTraceViewState | null = null

function Harness(props: {
  threadId: string | null
  visible: boolean
  threadRunning: boolean
}): ReactElement | null {
  exposed = useModelRequestTraces(props)
  return null
}

afterEach(() => {
  fetchPage.mockReset()
  exposed = null
  vi.useRealTimers()
})

describe('useModelRequestTraces', () => {
  it('deduplicates updated active attempts and orders newest records first', () => {
    const older = trace('older', 1, '2026-07-20T00:00:00.000Z')
    const pending = { ...trace('same', 2, '2026-07-20T00:00:01.000Z'), status: 'pending' as const }
    const completed = { ...pending, status: 'completed' as const, durationMs: 50 }
    expect(mergeModelRequestTraceRecords([older, pending], [completed])).toEqual([
      completed,
      older
    ])
  })

  it('loads only while visible and ignores a stale response after switching threads', async () => {
    const first = deferred<ModelRequestTracePage>()
    const second = deferred<ModelRequestTracePage>()
    fetchPage.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    let renderer!: ReactTestRenderer

    await act(async () => {
      renderer = create(createElement(Harness, {
        threadId: 'thread-a',
        visible: false,
        threadRunning: false
      }))
    })
    expect(fetchPage).not.toHaveBeenCalled()

    await act(async () => {
      renderer.update(createElement(Harness, {
        threadId: 'thread-a',
        visible: true,
        threadRunning: false
      }))
    })
    expect(fetchPage).toHaveBeenCalledWith('thread-a', { limit: 30 })

    await act(async () => {
      renderer.update(createElement(Harness, {
        threadId: 'thread-b',
        visible: true,
        threadRunning: false
      }))
    })
    first.resolve(page([trace('stale', 1, '2026-07-20T00:00:00.000Z')]))
    await act(async () => { await first.promise })
    expect(exposed?.records).toEqual([])

    second.resolve(page([trace('current', 2, '2026-07-20T00:00:01.000Z')]))
    await act(async () => { await second.promise })
    expect(exposed?.records.map((record) => record.id)).toEqual(['current'])
    expect(exposed?.selectedId).toBe('current')
    act(() => renderer.unmount())
  })

  it('polls a visible running thread and performs immediate and delayed refreshes when it settles', async () => {
    vi.useFakeTimers()
    fetchPage.mockResolvedValue(page([]))
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(Harness, {
        threadId: 'thread-a',
        visible: true,
        threadRunning: true
      }))
      await Promise.resolve()
    })
    expect(fetchPage).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(1_000)
      await Promise.resolve()
    })
    expect(fetchPage).toHaveBeenCalledTimes(2)

    await act(async () => {
      renderer.update(createElement(Harness, {
        threadId: 'thread-a',
        visible: true,
        threadRunning: false
      }))
      await Promise.resolve()
    })
    expect(fetchPage).toHaveBeenCalledTimes(3)

    await act(async () => {
      vi.advanceTimersByTime(1_000)
      await Promise.resolve()
    })
    expect(fetchPage).toHaveBeenCalledTimes(4)
    act(() => renderer.unmount())
  })

  it('keeps polling after the thread settles until a post-turn request completes', async () => {
    vi.useFakeTimers()
    const pending = {
      ...trace('title', 1, '2026-07-20T00:00:00.000Z'),
      status: 'pending' as const
    }
    const completed = {
      ...pending,
      status: 'completed' as const,
      response: {
        status: 200,
        statusText: 'OK',
        headers: { values: {}, redactedNames: [] },
        body: { text: 'data: title', capturedBytes: 11, originalBytes: 11, truncated: false }
      }
    }
    fetchPage
      .mockResolvedValueOnce(page([pending]))
      .mockResolvedValueOnce(page([completed]))
    let renderer!: ReactTestRenderer

    await act(async () => {
      renderer = create(createElement(Harness, {
        threadId: 'thread-a',
        visible: true,
        threadRunning: false
      }))
      await Promise.resolve()
    })
    expect(exposed?.activeCount).toBe(1)

    await act(async () => {
      vi.advanceTimersByTime(1_000)
      await Promise.resolve()
    })
    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(exposed?.records[0]).toEqual(completed)
    expect(exposed?.activeCount).toBe(0)

    await act(async () => {
      vi.advanceTimersByTime(1_000)
      await Promise.resolve()
    })
    expect(fetchPage).toHaveBeenCalledTimes(2)
    act(() => renderer.unmount())
  })
})
